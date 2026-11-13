/**
 * Move exported symbols (and whole modules) between workspace packages, and
 * rewrite every import that names them.
 *
 * Built for moving the CMS view model out of the kernel (`@rebasepro/types`,
 * `@rebasepro/common`) into `@rebasepro/cms-types` / `@rebasepro/cms` /
 * `@rebasepro/firebase`, and reusable for each later part of that move: the
 * declarations themselves are moved by hand (a split is a judgement call); this
 * rewrites the import lines, which is the part that must not be done by hand.
 *
 * The map (JSON):
 *
 *   {
 *     "symbols": [
 *       { "name": "evaluateCondition",
 *         "from": "packages/common/src/util/conditions.ts",
 *         "to":   "packages/cms-types/src/util/conditions.ts" }
 *     ],
 *     "files": { "packages/common/test/conditions.test.ts": "packages/cms-types/test/conditions.test.ts" }
 *   }
 *
 * - `symbols`: the declaring module before and after. An import of the symbol
 *   from the old package's bare name (`@rebasepro/common`), or by a relative path
 *   that resolves to `from`, is rewritten to the new package's bare name — or to a
 *   relative path to `to` when the importer is in the same package's `src`.
 *   Named imports, `import type`, inline `type` specifiers, aliases, mixed imports
 *   (some names stay, some move), `export { … } from` re-exports and `import("…").X`
 *   type references are all handled; a name that joins a package the file already
 *   imports from is merged into that import.
 * - `as` (optional, on a symbol): rename on move. The import names the new
 *   name, and every reference to the old local name in the file is renamed with
 *   it (`import type { CollectionConfig } from "@rebasepro/types"` + `x:
 *   CollectionConfig` → `import type { LegacyCollectionConfig } from
 *   "@rebasepro/common/migrate"` + `x: LegacyCollectionConfig`). An aliased
 *   import keeps its alias (`CollectionConfig as CC` → `LegacyCollectionConfig
 *   as CC`). A file that declares a local of the old name, or uses it in a
 *   shorthand property, is reported and left for a hand edit.
 * - `specifier` (optional, on a symbol): the specifier importers outside the
 *   target's own package `src` write, when it is not the package's bare name —
 *   a subpath such as `@rebasepro/common/migrate`.
 * - `files`: physical moves, done first (a file already at its destination is left
 *   alone, so a run is repeatable). Relative imports in a moved file, and relative
 *   imports OF a moved file, are recomputed: same package → relative path, another
 *   package → its bare name.
 *
 * Scanned: every .ts/.tsx/.mts under packages/, app/, examples/, tests/, tooling/,
 * saas/ (minus node_modules/dist), and the TypeScript code fences of the English
 * docs (`website/src/content/docs/docs/**`) and the agent skills
 * (`tooling/rebase-agent-skills/**`), so published examples keep compiling.
 *
 * Run: node --import tsx tooling/scripts/move-kernel-symbols.mts <map.json> [--dry-run] [--only <path-prefix>]… [--test-files] [--skip-dirty]
 *
 * - `--test-files`: rewrite only test code — files under a `test/`, `tests/`,
 *   `__tests__/` or `__fixtures__/` directory, `*.test.ts(x)` / `*.spec.ts(x)`
 *   files, and `*.type-test.ts` files (docs fences are skipped).
 * - `--skip-dirty`: leave alone, and list, every file that would change but
 *   already differs from HEAD (another author's uncommitted edit lives in it).
 *   Re-run in passes until that list is empty or stable.
 * - `--patch-from-head <out.patch> [--files <list.txt>]`: write nothing to the
 *   tree; instead apply the rewrite to each file's HEAD content and write the
 *   result as a patch against HEAD — the rewrite alone, whatever else the
 *   working copy holds, ready for a private-index commit. `--files` limits it
 *   to the repo-relative paths listed one per line.
 *
 * Prints every file it changed (or would change).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface SymbolMove {
    name: string;
    /** Repo-relative path of the declaring module before the move. */
    from: string;
    /** Repo-relative path of the declaring module after the move. */
    to: string;
    /** The symbol's name after the move, when it is renamed on the way. */
    as?: string;
    /** The specifier importers outside `to`'s own package `src` write (a subpath), instead of the bare package name. */
    specifier?: string;
}

export interface MoveMap {
    symbols?: SymbolMove[];
    files?: Record<string, string>;
}

const SOURCE_EXT = /\.(ts|tsx|mts|cts)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", ".astro", ".git", "coverage", ".turbo", "build", ".vite", ".claude"]);
const SCAN_DIRS = ["packages", "app", "examples", "tests", "tooling", "saas"];
const DOC_DIRS = ["website/src/content/docs/docs", "tooling/rebase-agent-skills"];

const posix = (p: string) => p.split(path.sep).join("/");
const rel = (abs: string) => posix(path.relative(ROOT, abs));

/** `packages/cms-types/src/x.ts` → `{ name: "cms-types", area: "src" }`. */
function packageOf(file: string): { name: string; area: string } | undefined {
    const match = /^packages\/([^/]+)\/([^/]+)\//.exec(file);
    return match ? { name: match[1], area: match[2] } : undefined;
}

function bareName(file: string): string {
    const pkg = packageOf(file);
    if (!pkg || pkg.area !== "src") throw new Error(`${file} is not inside a package's src: no bare specifier reaches it`);
    return `@rebasepro/${pkg.name}`;
}

/** Module specifier the importer (at `importer`) uses to reach `target`. */
function specifierFor(importer: string, target: string, viaIndexDir: boolean): string {
    const a = packageOf(importer);
    const b = packageOf(target);
    if (a && b && a.name === b.name && a.area === b.area) {
        let to = target.replace(/\.(d\.ts|ts|tsx|mts)$/, "");
        if (viaIndexDir) to = to.replace(/\/index$/, "");
        let out = posix(path.relative(path.dirname(importer), to));
        if (!out.startsWith(".")) out = `./${out}`;
        return out;
    }
    if (a && b && a.name === b.name && b.area === "src") {
        // A package's tests import its own source by its bare name (jest/vitest map it).
        return bareName(target);
    }
    return bareName(target);
}

/** The specifier `importer` uses to reach a moved symbol's new home. */
function moveSpecifier(importer: string, move: SymbolMove): string {
    const a = packageOf(importer);
    const b = packageOf(move.to);
    const sameSrc = a && b && a.name === b.name && a.area === b.area;
    return move.specifier && !sameSrc ? move.specifier : specifierFor(importer, move.to, false);
}

/** A test file or fixture: what `--test-files` limits a run to. */
export function isTestCode(file: string): boolean {
    return /(^|\/)(test|tests|__tests__|__fixtures__)\//.test(file) || /\.(test|spec)\.tsx?$/.test(file) || /\.type-test\.tsx?$/.test(file);
}

/** Whether a file differs from HEAD: someone's uncommitted edit lives in it. */
function isDirty(file: string): boolean {
    try {
        execFileSync("git", ["-c", "core.fsmonitor=false", "diff", "HEAD", "--quiet", "--", file], { cwd: ROOT, stdio: "ignore" });
        return false;
    } catch {
        return true;
    }
}

function walk(dir: string, accept: (name: string) => boolean, out: string[]): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, accept, out);
        else if (accept(entry.name)) out.push(full);
    }
}

// ---------------------------------------------------------------------------

interface Edit { start: number; end: number; text: string }

interface Context {
    /** name → moves of that name (a name can move out of two modules). */
    byName: Map<string, SymbolMove[]>;
    /** bare package → the moves out of it. */
    byPackage: Map<string, SymbolMove[]>;
    /** old path → new path (repo-relative), for physical moves. */
    files: Map<string, string>;
    /** new path → old path. */
    filesBack: Map<string, string>;
    exists: (file: string) => boolean;
}

/** Resolve a relative specifier written in a file at `fromFile` (its location when written). */
function resolveRelative(ctx: Context, fromFile: string, spec: string): { file: string; viaIndexDir: boolean } | undefined {
    const base = posix(path.normalize(path.join(path.dirname(fromFile), spec)));
    const stripped = base.replace(/\.(js|mjs|ts|tsx)$/, "");
    const candidates: Array<[string, boolean]> = [
        [base, false], [`${stripped}.ts`, false], [`${stripped}.tsx`, false], [`${stripped}.d.ts`, false],
        [`${stripped}.mts`, false], [`${base}/index.ts`, true], [`${base}/index.tsx`, true]
    ];
    for (const [candidate, viaIndexDir] of candidates) {
        if (/\.(ts|tsx|mts)$/.test(candidate) && (ctx.exists(candidate) || ctx.files.has(candidate))) {
            return { file: candidate, viaIndexDir };
        }
    }
    return undefined;
}

interface Group {
    spec: string;
    typeOnly: boolean;
    elements: string[];
}

function quoteOf(text: string): string {
    return text.includes("'") && !text.includes("\"") ? "'" : "\"";
}

function render(kind: "import" | "export", group: Group, original: string, quote: string): string {
    const semi = /;\s*$/.test(original) ? ";" : "";
    const head = `${kind}${group.typeOnly ? " type" : ""}`;
    if (original.includes("\n")) {
        const indent = /\n([ \t]+)\S/.exec(original)?.[1] ?? "    ";
        return `${head} {\n${group.elements.map(e => `${indent}${e}`).join(",\n")}\n} from ${quote}${group.spec}${quote}${semi}`;
    }
    return `${head} { ${group.elements.join(", ")} } from ${quote}${group.spec}${quote}${semi}`;
}

/**
 * The edits one source text needs. `here` is the file's path now; `written` where it
 * was when its relative specifiers were written (differs for a moved file).
 */
function editsFor(ctx: Context, text: string, here: string, written: string, kind: ts.ScriptKind): Edit[] {
    const source = ts.createSourceFile(here, text, ts.ScriptTarget.Latest, true, kind);
    const edits: Edit[] = [];

    /** Where a module specifier points: a bare kernel package or a resolved file. */
    const targetOf = (spec: string): { bare?: string; file?: string; viaIndexDir: boolean } | undefined => {
        if (spec.startsWith(".")) {
            const resolved = resolveRelative(ctx, written, spec);
            return resolved ? { file: resolved.file, viaIndexDir: resolved.viaIndexDir } : undefined;
        }
        return ctx.byPackage.has(spec) ? { bare: spec, viaIndexDir: false } : undefined;
    };

    /** The move that applies to `name` imported through `target`, if any. */
    const moveOf = (name: string, target: { bare?: string; file?: string }): SymbolMove | undefined => {
        for (const move of ctx.byName.get(name) ?? []) {
            if (target.bare && bareName(move.from) === target.bare) return move;
            if (target.file && (target.file === move.from || ctx.files.get(target.file) === move.from)) return move;
            // A barrel (`../src`, `../src/util`) re-exports its directory.
            if (target.file && /\/index\.tsx?$/.test(target.file) &&
                move.from.startsWith(`${path.posix.dirname(target.file)}/`)) return move;
        }
        return undefined;
    };

    /** The specifier for the module part that stays, recomputed if a file moved. */
    const staySpec = (spec: string, target: { bare?: string; file?: string; viaIndexDir: boolean }): string => {
        if (!target.file) return spec;
        const now = ctx.files.get(target.file) ?? target.file;
        if (now === target.file && here === written) return spec;
        return specifierFor(here, now, target.viaIndexDir);
    };

    /** Local names renamed by an `as` move: old local name → new name. */
    const renames = new Map<string, string>();
    /** An import/export element, with a renamed symbol's new name. */
    const renamedElement = (element: ts.ImportSpecifier | ts.ExportSpecifier, move: SymbolMove): string => {
        if (!move.as) return element.getText();
        const typePrefix = element.isTypeOnly ? "type " : "";
        if (element.propertyName) return `${typePrefix}${move.as} as ${element.name.text}`;
        // `export { X } from` re-exports under the new name; an import renames its references.
        if (ts.isImportSpecifier(element)) renames.set(element.name.text, move.as);
        return `${typePrefix}${move.as}`;
    };

    // Existing, untouched named imports, for merging: `${spec}|${typeOnly}` → declaration.
    const mergeable = new Map<string, ts.ImportDeclaration>();
    const pending = new Map<ts.ImportDeclaration, Group[]>();
    const additions = new Map<ts.ImportDeclaration, string[]>();

    for (const statement of source.statements) {
        const isImport = ts.isImportDeclaration(statement);
        const isExport = ts.isExportDeclaration(statement);
        if (!isImport && !isExport) continue;
        if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const spec = statement.moduleSpecifier.text;
        const target = targetOf(spec);
        const elementsNode = isImport
            ? (statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings) ? statement.importClause.namedBindings : undefined)
            : (statement.exportClause && ts.isNamedExports(statement.exportClause) ? statement.exportClause : undefined);
        const typeOnly = isImport ? Boolean(statement.importClause?.isTypeOnly) : statement.isTypeOnly;
        const hasDefault = isImport && Boolean(statement.importClause?.name);

        if (!target) {
            if (isImport && elementsNode && !hasDefault) mergeable.set(`${spec}|${typeOnly}`, statement);
            continue;
        }

        const newStay = staySpec(spec, target);
        if (!elementsNode) {
            // Side-effect, namespace or `export *`: only the specifier can change.
            if (newStay !== spec) {
                edits.push({ start: statement.moduleSpecifier.getStart(), end: statement.moduleSpecifier.getEnd(), text: `${quoteOf(statement.moduleSpecifier.getText())}${newStay}${quoteOf(statement.moduleSpecifier.getText())}` });
            }
            if (isImport && statement.importClause?.namedBindings && ts.isNamespaceImport(statement.importClause.namedBindings) && target.bare) {
                console.warn(`  ! ${here}: namespace import of ${spec} — check by hand`);
            }
            continue;
        }

        const groups: Group[] = [];
        const groupFor = (s: string, t: boolean) => {
            let g = groups.find(x => x.spec === s && x.typeOnly === t);
            if (!g) { g = { spec: s, typeOnly: t, elements: [] }; groups.push(g); }
            return g;
        };
        const stay: string[] = [];
        let moved = false;
        for (const element of elementsNode.elements) {
            const imported = (element.propertyName ?? element.name).text;
            const move = moveOf(imported, target);
            if (move && move.to === here) {
                // The declaration now lives in this very file.
                moved = true;
            } else if (move) {
                moved = true;
                groupFor(moveSpecifier(here, move), typeOnly).elements.push(renamedElement(element, move));
            } else stay.push(element.getText());
        }
        if (!moved && newStay === spec) {
            if (isImport && !hasDefault) mergeable.set(`${spec}|${typeOnly}`, statement);
            continue;
        }
        if (hasDefault) {
            console.warn(`  ! ${here}: default import alongside moved names from ${spec} — check by hand`);
            continue;
        }
        const all: Group[] = [];
        if (stay.length > 0) all.push({ spec: newStay, typeOnly, elements: stay });
        all.push(...groups);
        if (isImport) pending.set(statement, all);
        else {
            const quote = quoteOf(statement.moduleSpecifier.getText());
            edits.push({ start: statement.getStart(), end: statement.getEnd(), text: all.map(g => render("export", g, statement.getText(), quote)).join("\n") });
        }
    }

    for (const [statement, groups] of pending) {
        const quote = quoteOf(statement.moduleSpecifier.getText());
        const out: string[] = [];
        for (const group of groups) {
            const into = mergeable.get(`${group.spec}|${group.typeOnly}`);
            if (into && !pending.has(into)) {
                additions.set(into, [...(additions.get(into) ?? []), ...group.elements]);
                continue;
            }
            out.push(render("import", group, statement.getText(), quote));
        }
        // Removing the whole statement takes its line break with it.
        let end = statement.getEnd();
        if (out.length === 0 && text[end] === "\n") end += 1;
        edits.push({ start: statement.getStart(), end, text: out.join("\n") });
    }
    for (const [statement, extra] of additions) {
        const clause = statement.importClause!.namedBindings as ts.NamedImports;
        const existing = clause.elements.map(e => e.getText());
        const names = [...existing, ...extra.filter(e => !existing.includes(e))];
        const quote = quoteOf(statement.moduleSpecifier.getText());
        edits.push({
            start: statement.getStart(), end: statement.getEnd(),
            text: render("import", { spec: (statement.moduleSpecifier as ts.StringLiteral).text, typeOnly: Boolean(statement.importClause?.isTypeOnly), elements: names }, statement.getText(), quote)
        });
    }

    // `import("@rebasepro/types").Foo` in a type position.
    const visit = (node: ts.Node): void => {
        if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal) && node.qualifier) {
            const literal = node.argument.literal;
            const target = targetOf(literal.text);
            const first = ts.isIdentifier(node.qualifier) ? node.qualifier : node.qualifier.left;
            if (target && ts.isIdentifier(first)) {
                const move = moveOf(first.text, target);
                const spec = move ? moveSpecifier(here, move) : staySpec(literal.text, target);
                if (spec !== literal.text) {
                    const q = quoteOf(literal.getText());
                    edits.push({ start: literal.getStart(), end: literal.getEnd(), text: `${q}${spec}${q}` });
                }
                if (move?.as) edits.push({ start: first.getStart(), end: first.getEnd(), text: move.as });
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    if (renames.size > 0) {
        const refusal = renameReferences(source, renames, edits);
        if (refusal) {
            console.warn(`  ! ${here}: ${refusal} — left for a hand edit`);
            return [];
        }
    }
    return edits;
}

/**
 * Rename every reference to a renamed import's local name. Property names,
 * member names and qualified-name tails are not references; a local
 * declaration of the same name (which would shadow the import somewhere) and
 * a shorthand property (whose key would change with it) refuse the file.
 */
function renameReferences(source: ts.SourceFile, renames: Map<string, string>, edits: Edit[]): string | undefined {
    let refusal: string | undefined;
    const isNameSlot = (node: ts.Identifier): boolean => {
        const parent = node.parent;
        if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true;
        if (ts.isQualifiedName(parent) && parent.right === node) return true;
        if ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent) ||
            ts.isMethodSignature(parent) || ts.isMethodDeclaration(parent) || ts.isGetAccessor(parent) ||
            ts.isSetAccessor(parent) || ts.isEnumMember(parent)) && parent.name === node) return true;
        if (ts.isBindingElement(parent) && parent.propertyName === node) return true;
        if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return true;
        if (ts.isImportTypeNode(parent)) return true;
        if (ts.isJsxAttribute(parent)) return true;
        return false;
    };
    const isDeclarationName = (node: ts.Identifier): boolean => {
        const parent = node.parent;
        return (ts.isVariableDeclaration(parent) || ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) ||
            ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent) || ts.isParameter(parent) ||
            ts.isTypeParameterDeclaration(parent) || ts.isEnumDeclaration(parent) ||
            (ts.isBindingElement(parent) && parent.name === node)) && "name" in parent && parent.name === node;
    };
    const visit = (node: ts.Node): void => {
        if (refusal) return;
        if (ts.isImportTypeNode(node)) return;
        if (ts.isIdentifier(node)) {
            const next = renames.get(node.text);
            if (next && !isNameSlot(node)) {
                if (isDeclarationName(node)) refusal = `declares a local "${node.text}"`;
                else if (ts.isShorthandPropertyAssignment(node.parent)) refusal = `uses "${node.text}" as a shorthand property`;
                else edits.push({ start: node.getStart(), end: node.getEnd(), text: next });
            }
        }
        ts.forEachChild(node, visit);
    };
    for (const statement of source.statements) {
        if (ts.isImportDeclaration(statement)) continue;
        visit(statement);
    }
    return refusal;
}

function applyEdits(text: string, edits: Edit[]): string {
    let out = text;
    for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
        out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    }
    return out;
}

/** Rewrite the TypeScript code fences of a markdown file. */
function rewriteDoc(ctx: Context, text: string, file: string): string {
    return text.replace(/(```(?:ts|tsx|typescript|js|jsx)[^\n]*\n)([\s\S]*?)(```)/g, (whole, open: string, body: string, close: string) => {
        // A fence is not in any package: every specifier it writes is bare.
        const edits = editsFor(ctx, body, `docs/${file}`, `docs/${file}`, ts.ScriptKind.TSX);
        return edits.length === 0 ? whole : `${open}${applyEdits(body, edits)}${close}`;
    });
}

export interface MoveOptions {
    dryRun?: boolean;
    only?: string[];
    /** Rewrite only test code (see {@link isTestCode}); docs fences are skipped. */
    testFiles?: boolean;
    /** Leave files that already differ from HEAD alone, and list them in `skipped`. */
    skipDirty?: boolean;
    /** Filled with the files `skipDirty` left alone. */
    skipped?: string[];
    /** Read each file's HEAD content and return the rewrite as a patch instead of writing the tree. */
    patchFromHead?: { files?: Set<string>; patch: string[] };
}

function headText(file: string): string | undefined {
    try {
        return execFileSync("git", ["-c", "core.fsmonitor=false", "show", `HEAD:${file}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    } catch {
        return undefined;
    }
}

/** A unified diff of `file` from `before` to `after`, with repo-relative `a/`/`b/` paths. */
function patchOf(file: string, before: string, after: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "move-kernel-symbols-"));
    try {
        fs.writeFileSync(path.join(dir, "a"), before);
        fs.writeFileSync(path.join(dir, "b"), after);
        let out = "";
        try {
            execFileSync("git", ["diff", "--no-index", "--", path.join(dir, "a"), path.join(dir, "b")], { encoding: "utf8" });
        } catch (error) {
            const stdout = error instanceof Error && "stdout" in error ? error.stdout : undefined;
            out = typeof stdout === "string" ? stdout : "";
        }
        const body = out.slice(out.indexOf("\n@@") + 1);
        return `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n${body}`;
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

export function runMove(map: MoveMap, options: MoveOptions = {}): string[] {
    const files = new Map(Object.entries(map.files ?? {}));
    const filesBack = new Map([...files].map(([a, b]) => [b, a]));
    const byName = new Map<string, SymbolMove[]>();
    const byPackage = new Map<string, SymbolMove[]>();
    for (const move of map.symbols ?? []) {
        byName.set(move.name, [...(byName.get(move.name) ?? []), move]);
        const bare = bareName(move.from);
        byPackage.set(bare, [...(byPackage.get(bare) ?? []), move]);
    }

    // Physical moves first.
    for (const [from, to] of files) {
        const absFrom = path.join(ROOT, from);
        const absTo = path.join(ROOT, to);
        if (fs.existsSync(absTo) || !fs.existsSync(absFrom)) continue;
        if (options.dryRun) { console.log(`  mv ${from} → ${to}`); continue; }
        fs.mkdirSync(path.dirname(absTo), { recursive: true });
        fs.renameSync(absFrom, absTo);
        console.log(`  mv ${from} → ${to}`);
    }

    const ctx: Context = {
        byName, byPackage, files, filesBack,
        exists: (file) => fs.existsSync(path.join(ROOT, file)) || filesBack.has(file)
    };
    const inScope = (file: string) => (!options.only || options.only.some(prefix => file.startsWith(prefix))) &&
        (!options.testFiles || isTestCode(file));
    const changed: string[] = [];

    const sources: string[] = [];
    for (const dir of SCAN_DIRS) walk(path.join(ROOT, dir), name => SOURCE_EXT.test(name) && !name.endsWith(".d.ts"), sources);
    for (const abs of sources) {
        const here = rel(abs);
        if (!inScope(here)) continue;
        const fromHead = options.patchFromHead;
        if (fromHead?.files && !fromHead.files.has(here)) continue;
        const written = filesBack.get(here) ?? here;
        const text = fromHead ? headText(here) : fs.readFileSync(abs, "utf8");
        if (text === undefined) continue;
        // Cheap filter: a file that names no moved symbol, no moved file and was not moved itself.
        if (written === here && !(map.symbols ?? []).some(m => text.includes(m.name)) &&
            ![...files.keys()].some(f => text.includes(path.basename(f).replace(/\.(ts|tsx)$/, "")))) continue;
        const edits = editsFor(ctx, text, here, written, here.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        if (edits.length === 0) continue;
        if (fromHead) {
            fromHead.patch.push(patchOf(here, text, applyEdits(text, edits)));
            changed.push(here);
            continue;
        }
        if (options.skipDirty && isDirty(here)) {
            options.skipped?.push(here);
            continue;
        }
        changed.push(here);
        if (!options.dryRun) fs.writeFileSync(abs, applyEdits(text, edits));
    }

    const docs: string[] = [];
    if (!options.testFiles && !options.patchFromHead) for (const dir of DOC_DIRS) walk(path.join(ROOT, dir), name => /\.(md|mdx)$/.test(name), docs);
    for (const abs of docs) {
        const here = rel(abs);
        if (!inScope(here)) continue;
        const text = fs.readFileSync(abs, "utf8");
        if (!(map.symbols ?? []).some(m => text.includes(m.name))) continue;
        const next = rewriteDoc(ctx, text, here);
        if (next === text) continue;
        changed.push(here);
        if (!options.dryRun) fs.writeFileSync(abs, next);
    }
    return changed;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const args = process.argv.slice(2);
    const valued = new Set(["--only", "--patch-from-head", "--files"]);
    const mapPath = args.find((a, i) => !a.startsWith("--") && !valued.has(args[i - 1]));
    if (!mapPath) {
        console.error("usage: move-kernel-symbols.mts <map.json> [--dry-run] [--only <path-prefix>]… [--test-files] [--skip-dirty] [--patch-from-head <out.patch> [--files <list.txt>]]");
        process.exit(2);
    }
    const only: string[] = [];
    args.forEach((a, i) => { if (a === "--only" && args[i + 1]) only.push(args[i + 1]); });
    const map: MoveMap = JSON.parse(fs.readFileSync(path.resolve(mapPath), "utf8"));
    const skipped: string[] = [];
    const patchOut = args[args.indexOf("--patch-from-head") + 1];
    const filesList = args.includes("--files") ? args[args.indexOf("--files") + 1] : undefined;
    const patchFromHead = args.includes("--patch-from-head")
        ? {
            patch: [] as string[],
            ...(filesList ? { files: new Set(fs.readFileSync(path.resolve(filesList), "utf8").split("\n").map(line => line.trim()).filter(Boolean)) } : {})
        }
        : undefined;
    const changed = runMove(map, {
        patchFromHead,
        dryRun: args.includes("--dry-run"),
        only: only.length > 0 ? only : undefined,
        testFiles: args.includes("--test-files"),
        skipDirty: args.includes("--skip-dirty"),
        skipped
    });
    if (patchFromHead) fs.writeFileSync(path.resolve(patchOut), patchFromHead.patch.join(""));
    for (const file of changed) console.log(`  ${patchFromHead ? "patched (from HEAD)" : args.includes("--dry-run") ? "would rewrite" : "rewrote"} ${file}`);
    for (const file of skipped) console.log(`  skipped (uncommitted changes) ${file}`);
    console.log(`${changed.length} file(s)${skipped.length > 0 ? `, ${skipped.length} skipped` : ""}`);
}
