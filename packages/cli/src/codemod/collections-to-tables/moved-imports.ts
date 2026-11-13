/**
 * Rewriting a project's imports of names that moved, were renamed or were
 * removed in 0.31 — the third pass of `rebase migrate sdk-calls`, run on the
 * text the SDK-call passes wrote.
 *
 * The table is {@link MOVED_SYMBOLS} (generated from the headless guard's JSON:
 * the CMS view model and helpers that left `@rebasepro/types` /
 * `@rebasepro/common`) and {@link EXPORT_CHANGES} (the renames and removals
 * elsewhere). For every `import { … } from` / `export { … } from` whose module
 * is a package a name left:
 *
 * - a name with a destination moves to an import from that package — merged
 *   into an import of it the file already has, `import type` / inline `type`
 *   and `as` aliases kept, the rest of the declaration left where it is, a
 *   declaration left empty deleted. A rename renames the file's references
 *   to it too (an aliased import keeps its alias; a re-export keeps its public
 *   name). `import("pkg").Name` in a type is repointed the same way.
 * - a name without one (removed, or still exported with another meaning) is
 *   left as written and becomes a manual step with what to write instead.
 * - a namespace import (`import * as T`), `export *`, a dynamic `import()` or
 *   a `require()` of such a package that uses a moved name is not guessed at:
 *   a manual step names the file, the line and the names.
 *
 * Running it again on its own output changes nothing.
 */
import fs from "node:fs";
import path from "node:path";
import type { ExportDeclaration, ExportSpecifier, ImportDeclaration, ImportSpecifier, Node, SourceFile } from "ts-morph";

import type { AstContext } from "./ast";
import { toPosix } from "./ast";
import { CALL_OPTION_CHANGES, CODE_SPELLINGS, EXPORT_CHANGES, REMOVED_PACKAGES, SCRIPT_SPELLINGS, UPGRADE_GUIDE, type CodeSpelling } from "./export-changes";
import { MOVED_SYMBOLS } from "./moved-symbols.generated";
import { own } from "./own";
import type { ManualStep, MovedSymbol, Note } from "./types";

/** A replacement of `[start, end)` in a file's text. */
export interface TextEdit {
    start: number;
    end: number;
    text: string;
}

/** One name an import or re-export of the file now takes from another package or under another name. */
export interface MovedName {
    symbol: string;
    from: string;
    to: string;
    as?: string;
}

/** What the pass found in one file. */
export interface MovedImportsResult {
    edits: TextEdit[];
    moved: MovedName[];
    manualSteps: ManualStep[];
}

const key = (from: string, symbol: string): string => `${from}\0${symbol}`;

/** The table, generated rows over hand-written ones. */
const TABLE: ReadonlyMap<string, MovedSymbol> = (() => {
    const table = new Map<string, MovedSymbol>();
    for (const row of EXPORT_CHANGES) table.set(key(row.from, row.symbol), row);
    for (const row of MOVED_SYMBOLS) table.set(key(row.from, row.symbol), row);
    return table;
})();

/** The names each package lost. */
const BY_PACKAGE: ReadonlyMap<string, readonly MovedSymbol[]> = (() => {
    const out = new Map<string, MovedSymbol[]>();
    for (const row of TABLE.values()) out.set(row.from, [...(out.get(row.from) ?? []), row]);
    return out;
})();

/** The row for a name imported from a module, if it moved or changed. */
export function movedSymbol(from: string, symbol: string): MovedSymbol | undefined {
    return TABLE.get(key(from, symbol));
}

/** Every row of the table (generated rows win), for the report and the tests. */
export function movedSymbolTable(): readonly MovedSymbol[] {
    return [...TABLE.values()];
}

/** The package a module specifier belongs to (`@rebasepro/common/migrate` → `@rebasepro/common`). */
export function packageOf(specifier: string): string {
    const parts = specifier.split("/");
    return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

const guideLink = (row: { guide?: string }): string => (row.guide ? ` See ${UPGRADE_GUIDE}${row.guide}` : "");

/** A specifier of an import or re-export, as the model sees it. */
interface Spec {
    node: ImportSpecifier | ExportSpecifier;
    name: string;
    alias?: string;
    isType: boolean;
    /** Set when the name is renamed in place (same package): the specifier's new text. */
    renamed?: string;
}

/** A specifier to add to a declaration. */
interface Addition {
    text: string;
    isType: boolean;
}

interface DeclarationPlan {
    keep: Spec[];
    add: Addition[];
    /** New declarations written right after this one (or in its place when it ends up empty). */
    after: string[];
    touched: boolean;
}

function specsOf(declaration: ImportDeclaration | ExportDeclaration): Spec[] {
    const typeOnly = declaration.isTypeOnly();
    const named = "getNamedImports" in declaration ? declaration.getNamedImports() : declaration.getNamedExports();
    return named.map(node => {
        const alias = node.getAliasNode()?.getText();
        return { node, name: node.getNameNode().getText(), ...(alias ? { alias } : {}), isType: typeOnly || node.isTypeOnly() };
    });
}

/** The text of a specifier written into a declaration that is (or is not) type-only. */
function specText(text: string, isType: boolean, intoTypeOnly: boolean): string {
    return isType && !intoTypeOnly ? `type ${text}` : text;
}

/** A spec kept as written, its inline `type` adjusted to the declaration it ends up in. */
function keptText(spec: Spec, intoTypeOnly: boolean): string {
    const bare = spec.renamed ?? (spec.alias ? `${spec.name} as ${spec.alias}` : spec.name);
    return specText(bare, spec.isType, intoTypeOnly);
}

/** The braces of a declaration (`named`), rebuilt with `items`, in their own one-line or multi-line style. */
function braces(declaration: ImportDeclaration | ExportDeclaration, named: Node, items: string[]): string {
    const original = named.getText();
    if (!original.includes("\n")) return `{ ${items.join(", ")} }`;
    const sourceText = declaration.getSourceFile().getFullText();
    const indent = /\{\s*\n([ \t]*)/.exec(original)?.[1] ?? "    ";
    const declarationStart = declaration.getStart();
    const lineStart = sourceText.lastIndexOf("\n", declarationStart - 1) + 1;
    const closingIndent = /^[ \t]*/.exec(sourceText.slice(lineStart, declarationStart))?.[0] ?? "";
    return `{\n${items.map(item => `${indent}${item}`).join(",\n")}\n${closingIndent}}`;
}

/**
 * Names that moved to the panel's package but have a backend counterpart: in a
 * backend file the import is not moved to `@rebasepro/cms-types` (the server
 * does not run the panel's model) — the step names what the backend uses.
 */
const BACKEND_INSTEAD: Readonly<Record<string, string>> = {
    composeCallbacks: "on the backend, use `composeTableHooks` from @rebasepro/common: table hooks get `table` instead of `collection`, and `values` instead of `row` in afterRead / beforeDelete / afterDelete."
};

/** Whether a project file is backend code (under a `backend/` directory). */
function isBackendFile(relative: string): boolean {
    return /(^|\/)backend\//.test(relative);
}

/**
 * Plan the moves of one file.
 *
 * @param ctx the AST context
 * @param sf the file, parsed (syntax only)
 * @param relative its path from the project root, for the steps
 */
export function rewriteMovedImports(ctx: AstContext, sf: SourceFile, relative: string): MovedImportsResult {
    const { Node: N, SyntaxKind } = ctx.tsm;
    const result: MovedImportsResult = { edits: [], moved: [], manualSteps: [] };
    const removedLines: string[] = [];
    const unresolved: string[] = [];

    const imports = sf.getImportDeclarations();
    const reexports = sf.getExportDeclarations().filter(declaration => declaration.getModuleSpecifierValue() !== undefined);
    const plans = new Map<ImportDeclaration | ExportDeclaration, DeclarationPlan>();
    const planOf = (declaration: ImportDeclaration | ExportDeclaration): DeclarationPlan => {
        let plan = plans.get(declaration);
        if (!plan) {
            plan = { keep: specsOf(declaration), add: [], after: [], touched: false };
            plans.set(declaration, plan);
        }
        return plan;
    };
    /** Local names renamed: old → new. */
    const renamedLocals = new Map<string, string>();

    const groups: { kind: "import" | "export"; declarations: (ImportDeclaration | ExportDeclaration)[] }[] = [
        { kind: "import", declarations: imports },
        { kind: "export", declarations: reexports }
    ];
    for (const { kind, declarations } of groups) {
        // Moves out of each declaration, gathered by destination.
        const byDestination = new Map<string, { anchor: ImportDeclaration | ExportDeclaration; quote: string; specs: { text: string; isType: boolean }[] }>();
        for (const declaration of declarations) {
            const from = declaration.getModuleSpecifierValue();
            if (from === undefined) continue;
            const removedPackage = REMOVED_PACKAGES[from];
            if (removedPackage) {
                removedLines.push(`line ${declaration.getStartLineNumber()}: \`${from}\` is gone. ${removedPackage.instead}${guideLink(removedPackage)}`);
                continue;
            }
            if (!BY_PACKAGE.has(from)) continue;
            if (kind === "import" && N.isImportDeclaration(declaration) && declaration.getNamespaceImport()) continue;
            for (const spec of specsOf(declaration)) {
                const row = movedSymbol(from, spec.name);
                if (!row) continue;
                if (row.to === null) {
                    removedLines.push(`line ${declaration.getStartLineNumber()}: \`${spec.name}\` from ${from} — ${row.instead ?? "it is no longer exported."}${guideLink(row)}`);
                    continue;
                }
                const backendInstead = isBackendFile(relative) ? own(BACKEND_INSTEAD, spec.name) : undefined;
                if (backendInstead) {
                    removedLines.push(`line ${declaration.getStartLineNumber()}: \`${spec.name}\` from ${from} — ${backendInstead}`);
                    continue;
                }
                const plan = planOf(declaration);
                plan.touched = true;
                const newName = row.as ?? spec.name;
                let text: string;
                if (spec.alias) text = `${newName} as ${spec.alias}`;
                else if (newName !== spec.name && kind === "export") text = `${newName} as ${spec.name}`;
                else text = newName;
                if (kind === "import" && !spec.alias && newName !== spec.name) renamedLocals.set(spec.name, newName);
                result.moved.push({ symbol: spec.name, from, to: row.to, ...(row.as ? { as: row.as } : {}) });
                if (row.to === from) {
                    // Renamed in its own package: rewritten where it stands.
                    const kept = plan.keep.find(candidate => candidate.node === spec.node);
                    if (kept) kept.renamed = text;
                    continue;
                }
                plan.keep = plan.keep.filter(kept => kept.node !== spec.node);
                const quote = declaration.getModuleSpecifier()?.getText().charAt(0) ?? "\"";
                const group = byDestination.get(row.to) ?? { anchor: declaration, quote: quote === "'" ? "'" : "\"", specs: [] };
                if (!group.specs.some(existing => existing.text === text)) group.specs.push({ text, isType: spec.isType });
                byDestination.set(row.to, group);
            }
        }
        for (const [to, group] of byDestination) {
            const needsValue = group.specs.some(spec => !spec.isType);
            const candidates = declarations.filter(declaration => declaration.getModuleSpecifierValue() === to &&
                !(N.isImportDeclaration(declaration) && declaration.getNamespaceImport()) &&
                !(N.isExportDeclaration(declaration) && !declaration.hasNamedExports()));
            const target = needsValue
                ? candidates.find(declaration => !declaration.isTypeOnly())
                : candidates.find(declaration => declaration.isTypeOnly()) ?? candidates[0];
            if (target) {
                const plan = planOf(target);
                const existing = new Set(plan.keep.map(spec => (spec.alias ? `${spec.name} as ${spec.alias}` : spec.name)));
                for (const spec of group.specs) {
                    if (existing.has(spec.text) || plan.add.some(added => added.text === spec.text)) continue;
                    plan.add.push(spec);
                }
                plan.touched = true;
                continue;
            }
            const typeOnly = !needsValue;
            const items = group.specs.map(spec => specText(spec.text, spec.isType, typeOnly));
            const statement = `${kind} ${typeOnly ? "type " : ""}{ ${items.join(", ")} } from ${group.quote}${to}${group.quote};`;
            const plan = planOf(group.anchor);
            plan.after.push(statement);
            plan.touched = true;
        }
    }

    // Render each touched declaration once.
    const text = sf.getFullText();
    for (const [declaration, plan] of plans) {
        if (!plan.touched) continue;
        const typeOnly = declaration.isTypeOnly();
        const items = [...plan.keep.map(spec => keptText(spec, typeOnly)), ...plan.add.map(added => specText(added.text, added.isType, typeOnly))];
        const hasDefault = N.isImportDeclaration(declaration) && declaration.getDefaultImport() !== undefined;
        const lineStart = text.lastIndexOf("\n", declaration.getStart() - 1) + 1;
        const indent = /^[ \t]*/.exec(text.slice(lineStart, declaration.getStart()))?.[0] ?? "";
        const after = plan.after.map(statement => `\n${indent}${statement}`).join("");
        if (items.length === 0 && !hasDefault) {
            if (plan.after.length > 0) {
                result.edits.push({ start: declaration.getStart(), end: declaration.getEnd(), text: plan.after.join(`\n${indent}`) });
            } else {
                // Delete the declaration and its line.
                let end = declaration.getEnd();
                if (text[end] === "\r") end++;
                if (text[end] === "\n") end++;
                result.edits.push({ start: lineStart, end, text: "" });
            }
            continue;
        }
        const named = N.isImportDeclaration(declaration) ? declaration.getImportClause()?.getNamedBindings() : declaration.getFirstChildByKind(SyntaxKind.NamedExports);
        if (named && (N.isNamedImports(named) || N.isNamedExports(named))) {
            const defaultImport = N.isImportDeclaration(declaration) ? declaration.getDefaultImport() : undefined;
            if (items.length === 0 && defaultImport) {
                // `import Default, { moved } from` → `import Default from`.
                result.edits.push({ start: defaultImport.getEnd(), end: named.getEnd(), text: "" });
            } else {
                result.edits.push({ start: named.getStart(), end: named.getEnd(), text: braces(declaration, named, items) });
            }
        }
        if (after) result.edits.push({ start: declaration.getEnd(), end: declaration.getEnd(), text: after });
    }

    // References to a renamed import.
    if (renamedLocals.size > 0) {
        for (const identifier of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
            const next = renamedLocals.get(identifier.getText());
            if (!next) continue;
            const parent = identifier.getParent();
            if (!parent || N.isImportSpecifier(parent) || N.isImportClause(parent) || N.isNamespaceImport(parent) || N.isImportTypeNode(parent)) continue;
            if (N.isPropertyAccessExpression(parent) && parent.getNameNode() === identifier) continue;
            if (N.isQualifiedName(parent) && parent.getRight() === identifier) continue;
            if ((N.isPropertyAssignment(parent) || N.isPropertySignature(parent) || N.isMethodDeclaration(parent) || N.isPropertyDeclaration(parent) ||
                N.isMethodSignature(parent) || N.isGetAccessorDeclaration(parent) || N.isSetAccessorDeclaration(parent)) && parent.getNameNode() === identifier) continue;
            if (N.isShorthandPropertyAssignment(parent)) {
                result.edits.push({ start: identifier.getStart(), end: identifier.getEnd(), text: `${identifier.getText()}: ${next}` });
                continue;
            }
            if (N.isExportSpecifier(parent)) {
                if (parent.getExportDeclaration().getModuleSpecifierValue() !== undefined) continue;
                if (parent.getNameNode() === identifier) {
                    result.edits.push({ start: identifier.getStart(), end: identifier.getEnd(), text: parent.getAliasNode() ? next : `${next} as ${identifier.getText()}` });
                }
                continue;
            }
            result.edits.push({ start: identifier.getStart(), end: identifier.getEnd(), text: next });
        }
    }

    // `import("pkg").Name` in a type.
    for (const importType of sf.getDescendantsOfKind(SyntaxKind.ImportType)) {
        const argument = importType.getArgument();
        const literal = N.isLiteralTypeNode(argument) ? argument.getLiteral() : undefined;
        if (!literal || !N.isStringLiteral(literal)) continue;
        const from = literal.getLiteralValue();
        const qualifier = importType.getQualifier();
        if (!qualifier || !BY_PACKAGE.has(from)) continue;
        const first = N.isIdentifier(qualifier) ? qualifier : qualifier.getFirstDescendantByKind(SyntaxKind.Identifier);
        if (!first) continue;
        const row = movedSymbol(from, first.getText());
        if (!row) continue;
        if (row.to === null) {
            removedLines.push(`line ${importType.getStartLineNumber()}: \`import("${from}").${first.getText()}\` — ${row.instead ?? "it is no longer exported."}${guideLink(row)}`);
            continue;
        }
        const quote = literal.getText().charAt(0);
        result.edits.push({ start: literal.getStart(), end: literal.getEnd(), text: `${quote}${row.to}${quote}` });
        if (row.as) result.edits.push({ start: first.getStart(), end: first.getEnd(), text: row.as });
        result.moved.push({ symbol: first.getText(), from, to: row.to, ...(row.as ? { as: row.as } : {}) });
    }

    // Namespace imports, `export *`, dynamic imports and `require()`: not guessed at.
    for (const declaration of imports) {
        const from = declaration.getModuleSpecifierValue();
        const namespace = declaration.getNamespaceImport();
        if (!namespace || !BY_PACKAGE.has(from)) continue;
        const local = namespace.getText();
        const uses = new Map<string, number[]>();
        const record = (name: string, node: Node): void => {
            if (!movedSymbol(from, name)) return;
            uses.set(name, [...(uses.get(name) ?? []), node.getStartLineNumber()]);
        };
        for (const access of sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
            if (access.getExpression().getText() === local) record(access.getName(), access);
        }
        for (const qualified of sf.getDescendantsOfKind(SyntaxKind.QualifiedName)) {
            if (qualified.getLeft().getText() === local) record(qualified.getRight().getText(), qualified);
        }
        if (uses.size > 0) unresolved.push(`line ${declaration.getStartLineNumber()}: \`import * as ${local} from "${from}"\` uses ${describeUses(from, uses, local)}`);
    }
    for (const declaration of sf.getExportDeclarations()) {
        const from = declaration.getModuleSpecifierValue();
        if (from === undefined || declaration.hasNamedExports() || !BY_PACKAGE.has(from)) continue;
        const moved = (BY_PACKAGE.get(from) ?? []).filter(row => row.to !== null);
        const destinations = [...new Set(moved.map(row => row.to))];
        if (moved.length === 0) continue;
        unresolved.push(`line ${declaration.getStartLineNumber()}: \`${declaration.getText()}\` no longer re-exports ${moved.length} name(s) that moved (${moved.slice(0, 6).map(row => row.symbol).join(", ")}${moved.length > 6 ? ", …" : ""}). If this module's importers read them through it, also re-export them from ${destinations.join(", ")}.`);
    }
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const callee = call.getExpression();
        const isDynamic = callee.getKind() === SyntaxKind.ImportKeyword;
        const isRequire = N.isIdentifier(callee) && callee.getText() === "require";
        if (!isDynamic && !isRequire) continue;
        const argument = call.getArguments()[0];
        if (!argument || !N.isStringLiteral(argument)) continue;
        const from = argument.getLiteralValue();
        if (!BY_PACKAGE.has(from)) continue;
        const uses = new Map<string, number[]>();
        for (const identifier of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
            if (!movedSymbol(from, identifier.getText())) continue;
            const parent = identifier.getParent();
            if (parent && (N.isImportSpecifier(parent) || N.isExportSpecifier(parent))) continue;
            uses.set(identifier.getText(), [...(uses.get(identifier.getText()) ?? []), identifier.getStartLineNumber()]);
        }
        if (uses.size > 0) unresolved.push(`line ${call.getStartLineNumber()}: \`${isDynamic ? "import" : "require"}("${from}")\` and ${describeUses(from, uses)}`);
    }

    if (removedLines.length > 0) {
        result.manualSteps.push({
            title: `Replace what 0.31 removed or changed in ${relative}`,
            detail: `The codemod leaves these imports as written; each needs a hand edit. ${removedLines.join("; ")}`,
            file: relative
        });
    }
    if (unresolved.length > 0) {
        result.manualSteps.push({
            title: `Repoint the moved names ${relative} reaches without a named import`,
            detail: `The codemod rewrites named imports only. ${unresolved.join("; ")}`,
            file: relative
        });
    }
    return result;
}

function describeUses(from: string, uses: ReadonlyMap<string, number[]>, local?: string): string {
    return [...uses].map(([name, lines]) => {
        const row = movedSymbol(from, name);
        const where = row?.to ? `now in ${row.to}${row.as ? ` as \`${row.as}\`` : ""}` : `gone — ${row?.instead ?? ""}`;
        return `\`${local ? `${local}.` : ""}${name}\` (line ${[...new Set(lines)].join(", ")}; ${where})`;
    }).join(", ");
}

const SPELLING_SOURCES = new RegExp([
    "@rebasepro/",
    ...CALL_OPTION_CHANGES.map(change => `\\b${change.callee}\\b`),
    ...CODE_SPELLINGS.map(spelling => spelling.pattern.source)
].join("|"));

/** Whether a file can hold anything this pass reads (so the rest are never parsed). */
export function mayNeedImportPass(text: string): boolean {
    return SPELLING_SOURCES.test(text);
}

/** The lines of `text` matching a spelling, 1-based. */
function matchingLines(text: string, spelling: CodeSpelling): number[] {
    if (spelling.onlyIf && !spelling.onlyIf.test(text)) return [];
    const lines = new Set<number>();
    for (const match of text.matchAll(spelling.pattern)) lines.add(text.slice(0, match.index).split("\n").length);
    return [...lines];
}

/**
 * The spellings of a source file whose meaning changed (never rewritten):
 * {@link CODE_SPELLINGS}, and the call options of {@link CALL_OPTION_CHANGES}.
 */
export function detectChangedSpellings(ctx: AstContext, sf: SourceFile, relative: string): ManualStep[] {
    const { Node: N, SyntaxKind } = ctx.tsm;
    const text = sf.getFullText();
    const found: string[] = [];
    for (const spelling of CODE_SPELLINGS) {
        const lines = matchingLines(text, spelling);
        if (lines.length > 0) found.push(`${spelling.spelling} (line ${lines.join(", ")}): ${spelling.instead} See ${UPGRADE_GUIDE}${spelling.guide}`);
    }
    for (const change of CALL_OPTION_CHANGES) {
        if (!text.includes(change.callee)) continue;
        for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
            const callee = call.getExpression();
            const name = N.isPropertyAccessExpression(callee) ? callee.getName() : callee.getText();
            if (name !== change.callee) continue;
            const keys = call.getArguments().flatMap(argument => (N.isObjectLiteralExpression(argument)
                ? argument.getProperties().flatMap(property => ((N.isPropertyAssignment(property) || N.isShorthandPropertyAssignment(property)) && change.keys.includes(property.getName()) ? [property.getName()] : []))
                : []));
            if (keys.length > 0) found.push(`\`${change.callee}({ ${keys.join(", ")} })\` (line ${call.getStartLineNumber()}): ${change.instead} See ${UPGRADE_GUIDE}${change.guide}`);
        }
    }
    if (found.length === 0) return [];
    return [{
        title: `Update what changed meaning in ${relative}`,
        detail: `The codemod does not rewrite these: the new spelling means something different, so each is yours to adapt. ${found.join("; ")}`,
        file: relative
    }];
}

/** A dependency the run added to a workspace package. */
export interface AddedDependency {
    /** The `package.json`, relative to the project root. */
    file: string;
    name: string;
    version: string;
}

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies"] as const;

/** The nearest `package.json` above a file, inside the project. */
function nearestPackageJson(root: string, file: string): string | undefined {
    let dir = path.dirname(file);
    for (;;) {
        const candidate = path.join(dir, "package.json");
        if (fs.existsSync(candidate)) return candidate;
        if (path.resolve(dir) === path.resolve(root) || path.dirname(dir) === dir) return undefined;
        dir = path.dirname(dir);
    }
}

/** The range a manifest gives its `@rebasepro/*` packages (the first one listed). */
function rebaseRange(manifest: JsonObject): string | undefined {
    for (const field of DEPENDENCY_FIELDS) {
        const deps = manifest[field];
        if (!isObject(deps)) continue;
        for (const [name, range] of Object.entries(deps)) if (name.startsWith("@rebasepro/") && typeof range === "string") return range;
    }
    return undefined;
}

/**
 * Add each package a moved import now names to the workspace package that
 * imports it, when that package does not depend on it yet: in `dependencies`,
 * with the range it gives its other `@rebasepro/*` packages (or the root's).
 * A package with no such range to copy is a manual step.
 *
 * @param root the project root
 * @param needed source file → the packages its imports now name
 * @param read a file's current text (the migration's planned content first)
 */
export function planDependencies(root: string, needed: ReadonlyMap<string, ReadonlySet<string>>, read: (file: string) => string | undefined): { files: Map<string, string>; added: AddedDependency[]; manualSteps: ManualStep[]; notes: Note[] } {
    const out = { files: new Map<string, string>(), added: [] as AddedDependency[], manualSteps: [] as ManualStep[], notes: [] as Note[] };
    const byManifest = new Map<string, Set<string>>();
    for (const [file, packages] of needed) {
        const manifest = nearestPackageJson(root, file);
        if (!manifest) continue;
        const set = byManifest.get(manifest) ?? new Set<string>();
        for (const name of packages) set.add(packageOf(name));
        byManifest.set(manifest, set);
    }
    const parse = (file: string): { value: JsonObject; text: string } | undefined => {
        const text = read(file);
        if (text === undefined) return undefined;
        try {
            const value: unknown = JSON.parse(text);
            return isObject(value) ? { value, text } : undefined;
        } catch {
            return undefined;
        }
    };
    const rootManifest = parse(path.join(root, "package.json"));
    for (const [manifest, packages] of [...byManifest].sort(([a], [b]) => a.localeCompare(b))) {
        const parsed = parse(manifest);
        if (!parsed) continue;
        const relative = toPosix(path.relative(root, manifest));
        const declared = (name: string): boolean => DEPENDENCY_FIELDS.some(field => {
            const deps = parsed.value[field];
            return isObject(deps) && name in deps;
        });
        const ownName = typeof parsed.value.name === "string" ? parsed.value.name : undefined;
        const missing = [...packages].filter(name => name !== ownName && !declared(name)).sort();
        if (missing.length === 0) continue;
        const range = rebaseRange(parsed.value) ?? (rootManifest ? rebaseRange(rootManifest.value) : undefined);
        if (!range) {
            out.manualSteps.push({
                title: `Add ${missing.join(", ")} to ${relative}`,
                detail: `Imports under ${path.posix.dirname(relative) || "the project root"} now name ${missing.join(", ")}, which ${relative} does not depend on, and it lists no other @rebasepro package to copy the version from. Add ${missing.length > 1 ? "them" : "it"} at the version of your other @rebasepro packages, then install.`,
                snippet: missing.map(name => `"${name}": "<the version of your other @rebasepro packages>"`).join(",\n"),
                file: relative
            });
            continue;
        }
        const dependencies = isObject(parsed.value.dependencies) ? { ...parsed.value.dependencies } : {};
        const keys = Object.keys(dependencies);
        const sorted = keys.every((name, index) => index === 0 || keys[index - 1].localeCompare(name) <= 0);
        for (const name of missing) {
            dependencies[name] = range;
            out.added.push({ file: relative, name, version: range });
        }
        const next = sorted ? Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b))) : dependencies;
        const indent = /\n([ \t]+)"/.exec(parsed.text)?.[1] ?? "  ";
        out.files.set(manifest, `${JSON.stringify({ ...parsed.value, dependencies: next }, null, indent)}${parsed.text.endsWith("\n") ? "\n" : ""}`);
        out.notes.push({ file: relative, message: `added ${missing.map(name => `${name}@${range}`).join(", ")} to dependencies: imports moved there. Run your package manager's install.` });
        out.manualSteps.push({
            title: `Install the packages added to ${relative}`,
            detail: `Imports moved to ${missing.join(", ")}, so the codemod added ${missing.length > 1 ? "them" : "it"} to ${relative} at ${range}, the range of your other @rebasepro packages. Run your package manager's install.`,
            file: relative
        });
    }
    return out;
}

/** The old CLI spellings in a `package.json`'s scripts: a manual step, never rewritten. */
export function detectScriptSpellings(manifestText: string, relative: string): ManualStep[] {
    let scripts: unknown;
    try {
        const value: unknown = JSON.parse(manifestText);
        scripts = isObject(value) ? value.scripts : undefined;
    } catch {
        return [];
    }
    if (!isObject(scripts)) return [];
    const found: string[] = [];
    for (const [name, script] of Object.entries(scripts)) {
        if (typeof script !== "string") continue;
        for (const spelling of SCRIPT_SPELLINGS) {
            if (matchingLines(script, spelling).length > 0) found.push(`script "${name}" uses ${spelling.spelling}: ${spelling.instead} See ${UPGRADE_GUIDE}${spelling.guide}`);
        }
    }
    if (found.length === 0) return [];
    return [{ title: `Update the CLI flags in ${relative}`, detail: found.join("; "), file: relative }];
}
