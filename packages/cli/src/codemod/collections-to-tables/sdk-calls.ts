/**
 * Rewriting a project's own code for the SDK and server renames that came
 * with tables (`rebase migrate sdk-calls`, and part of
 * `rebase migrate collections-to-tables` unless `--skip-sdk-calls`).
 *
 * The rules (from the SDK and server slices):
 *
 * 1. `.collection(` → `.table(` on the SDK data surface: `client.data`,
 *    `rebase.data`, `rebase.dataAsAdmin`, `context.data`, `ctx.data`,
 *    `openRebase().data`, `useData()` / `useSdkData()`, a `createRebaseClient()`
 *    result — type arguments kept (`context.data.collection<T>("x")`).
 * 2. `createRebaseClient({ … })`: `collections:` → `tables:`,
 *    `collectionsDictionary` → `tablesDictionary`.
 * 3. From the generated `database.types`: `CollectionName` → `TableName`,
 *    `CollectionsDictionary` → `TablesDictionary`.
 * 4. Batch operations: `{ op, collection }` → `{ op, table }`.
 * 5. `CollectionClient` → `TableClient`, `SDKCollectionClient` →
 *    `SDKTableClient`, `CollectionAccessor` → `TableAccessor`,
 *    `CollectionTrashAccessor` → `TableTrashAccessor`.
 * 6. Error codes: `UNKNOWN_COLLECTION` → `UNKNOWN_TABLE`,
 *    `INVALID_COLLECTION_PATH` → `INVALID_TABLE_PATH`, `NO_COLLECTIONS` →
 *    `NO_TABLES`, `COLLECTION_READ_ONLY` → `TABLE_READ_ONLY`.
 * 7. `maxCachedQueriesPerCollection` / `maxCachedRowsPerCollection` → `…PerTable`.
 * 8. Typed accessors on the data surface: `xCollection` → `xTable`,
 *    `collectionCollection` → `collection`.
 * 9. `setCollectionCallbacks(slug, cb)` → `setTableHooks(slug, hooks)`, the
 *    callbacks' props adapted as table hooks are (`collection` → `table`,
 *    `row` → `values`), `CollectionCallbacks` → `TableHooks`.
 * 10. `storageAuthorize`'s data: `.collection` → `.table`.
 * 11. The rule vocabulary: an `existsIn` policy names its table with `table`
 *    (`policy.existsIn({ collection: X …` → `table: X`, a literal
 *    `{ kind: "existsIn", collection: X }` the same), and a tenant
 *    membership source too (`membership: { collection: X …` →
 *    `membership: { table: X …`). Wherever the rule is written: a table's
 *    `rls`, a shared rule helper, a `tenant` option.
 *
 * The receiver of a `.collection(` call decides. Where a TypeScript program
 * can be built for the file (its nearest tsconfig, the workspace's sources
 * when aliases are given), a receiver whose type is the SDK's data surface
 * (it has the SDK's `table` method) is rewritten whatever its spelling.
 * Otherwise only the receivers in the list above are. Anything else — a
 * Firestore `collection(db, "x")`, a CMS helper, a method of the user's own
 * that happens to share the name — is left as written and reported, with
 * its file and line, so a person can check it.
 *
 * Boot options (`collections`, `collectionsDir`, `callbacks`,
 * `auth.collection`) are rewritten only in the one shape the codemod can
 * prove (`collectionsDir: path.join(__dirname, "…/config/collections")`);
 * anything else is a manual step with the snippet. Generated SDK files are
 * never rewritten: `rebase generate-sdk` writes them again.
 */
import fs from "node:fs";
import path from "node:path";
import type { CallExpression, Node, ObjectLiteralExpression, Project, SourceFile } from "ts-morph";

import type { AstContext, Member, TsMorph } from "./ast";
import { createAstContext, nodeText, resolveObject, toPosix } from "./ast";
import { carryHook } from "./hooks";
import { own } from "./own";
import { reindent } from "./print-js";
import type { ManualStep, Note } from "./types";
import { RULE_KEY_RENAMES } from "./vocabulary";

/** The rules, by the name the report counts them under. */
export type SdkRule =
    | "collection-call" | "client-options" | "generated-types" | "batch-op" | "type-names" | "error-codes"
    | "offline-options" | "typed-accessor" | "table-hooks" | "storage-authorize" | "boot-options" | "rule-vocabulary";

/** One `.collection(` left alone, and why. */
export interface LeftUnchanged {
    file: string;
    line: number;
    code: string;
    reason: string;
}

/** What one rewrite run did. */
export interface SdkRewriteReport {
    /** Files rewritten, relative to the root, with how many edits each. */
    files: { path: string; edits: number }[];
    /** Edits by rule. */
    counts: Partial<Record<SdkRule, number>>;
    left: LeftUnchanged[];
    manualSteps: ManualStep[];
    notes: Note[];
    /** Generated SDK files found (not rewritten). */
    generated: string[];
    /** Whether receivers were checked by type in at least one file. */
    typeAware: boolean;
}

const RECEIVER_OWNERS = new Set(["client", "rebase", "rebaseClient", "context", "ctx"]);
const DATA_PROPERTIES = new Set(["data", "dataAsAdmin"]);
const DATA_HOOKS = new Set(["useData", "useSdkData"]);
const CLIENT_FACTORY = "createRebaseClient";
const TYPE_RENAMES: Readonly<Record<string, string>> = {
    CollectionClient: "TableClient",
    SDKCollectionClient: "SDKTableClient",
    CollectionAccessor: "TableAccessor",
    CollectionTrashAccessor: "TableTrashAccessor"
};
const GENERATED_TYPE_RENAMES: Readonly<Record<string, string>> = {
    CollectionName: "TableName",
    CollectionsDictionary: "TablesDictionary"
};
const ERROR_CODES: Readonly<Record<string, string>> = {
    UNKNOWN_COLLECTION: "UNKNOWN_TABLE",
    INVALID_COLLECTION_PATH: "INVALID_TABLE_PATH",
    NO_COLLECTIONS: "NO_TABLES",
    COLLECTION_READ_ONLY: "TABLE_READ_ONLY"
};
const OFFLINE_OPTIONS: Readonly<Record<string, string>> = {
    maxCachedQueriesPerCollection: "maxCachedQueriesPerTable",
    maxCachedRowsPerCollection: "maxCachedRowsPerTable"
};

const SOURCE = /\.(ts|tsx|mts|js|mjs)$/;
const IGNORED_DIRS = new Set(["node_modules", "dist", "build", "out", ".git", "coverage", ".turbo", ".next", ".rebase", "dist-bundle", "test-results"]);

/** Whether a file is generated SDK output, which `rebase generate-sdk` rewrites. */
export function isGeneratedSdkFile(file: string, text: string): boolean {
    const head = text.slice(0, 400);
    if (/auto-generated by Rebase|@generated|DO NOT EDIT/i.test(head)) return true;
    return /[\\/]generated[\\/]/.test(file) && /(database\.types|schema\.meta|register)\.ts$/.test(file);
}

/** Every source file of a project the rewrite reads. */
export function sdkSourceFiles(root: string, skipDirs: readonly string[] = []): string[] {
    const out: string[] = [];
    const skip = new Set(skipDirs.map(dir => path.resolve(dir)));
    const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!skip.has(full)) walk(full);
            } else if (SOURCE.test(entry.name) && !entry.name.endsWith(".d.ts")) {
                out.push(full);
            }
        }
    };
    walk(root);
    return out.sort();
}

interface Edit {
    start: number;
    end: number;
    text: string;
    rule: SdkRule;
}

/** A type checker for the files under one tsconfig, when one can be built. */
class TypeOracle {
    private readonly projects = new Map<string, Project | null>();
    used = false;

    constructor(private readonly tsm: TsMorph, private readonly root: string, private readonly aliases: Record<string, string>) {}

    private tsconfigOf(file: string): string | undefined {
        let dir = path.dirname(file);
        for (;;) {
            const candidate = path.join(dir, "tsconfig.json");
            if (fs.existsSync(candidate)) return candidate;
            if (dir === this.root || path.dirname(dir) === dir) return undefined;
            dir = path.dirname(dir);
        }
    }

    /** The file as a node of a typed program, or undefined. */
    sourceFile(file: string, text: string): SourceFile | undefined {
        const tsconfig = this.tsconfigOf(file);
        if (!tsconfig) return undefined;
        let project = this.projects.get(tsconfig);
        if (project === undefined) {
            try {
                const paths: Record<string, string[]> = {};
                for (const [specifier, target] of Object.entries(this.aliases)) paths[specifier] = [target];
                project = new this.tsm.Project({
                    tsConfigFilePath: tsconfig,
                    skipAddingFilesFromTsConfig: true,
                    ...(Object.keys(paths).length > 0 ? { compilerOptions: { paths, noEmit: true } } : {})
                });
            } catch {
                project = null;
            }
            this.projects.set(tsconfig, project);
        }
        if (!project) return undefined;
        return project.createSourceFile(file, text, { overwrite: true });
    }

    /** Whether a receiver's type is the SDK data surface: it has the SDK's `table` method. */
    isSdkData(receiver: Node): boolean | undefined {
        try {
            const type = receiver.getType();
            if (type.isAny() || type.isUnknown()) return undefined;
            const table = type.getProperty("table");
            if (!table) return false;
            this.used = true;
            return table.getDeclarations().some(declaration => /[\\/](packages[\\/](client|types|common)|@rebasepro[\\/])/.test(declaration.getSourceFile().getFilePath()));
        } catch {
            return undefined;
        }
    }
}

/** Whether a receiver is on the syntactic list (rule 1), following a same-scope `const` once. */
function isListedReceiver(ctx: AstContext, receiver: Node, depth = 0): boolean {
    const { Node: N } = ctx.tsm;
    if (N.isNonNullExpression(receiver) || N.isParenthesizedExpression(receiver) || N.isAsExpression(receiver)) {
        return isListedReceiver(ctx, receiver.getExpression(), depth);
    }
    if (N.isPropertyAccessExpression(receiver) && DATA_PROPERTIES.has(receiver.getName())) {
        const owner = receiver.getExpression();
        if (N.isIdentifier(owner) && RECEIVER_OWNERS.has(owner.getText())) return true;
        if (N.isPropertyAccessExpression(owner) && RECEIVER_OWNERS.has(owner.getName())) return true;
        if (N.isCallExpression(owner) && owner.getExpression().getText() === "openRebase") return true;
        if (N.isAwaitExpression(owner)) {
            const inner = owner.getExpression();
            if (N.isCallExpression(inner) && inner.getExpression().getText() === "openRebase") return true;
        }
        if (N.isIdentifier(owner) && depth === 0) return isFactoryResult(ctx, owner);
        return false;
    }
    if (N.isCallExpression(receiver) && DATA_HOOKS.has(receiver.getExpression().getText())) return true;
    if (N.isIdentifier(receiver) && depth === 0) {
        if (isFactoryResult(ctx, receiver)) return true;
        const declaration = receiver.getSymbol()?.getDeclarations()[0];
        if (declaration && N.isVariableDeclaration(declaration)) {
            const initializer = declaration.getInitializer();
            if (initializer) return isListedReceiver(ctx, initializer, depth + 1);
        }
    }
    return false;
}

/** Whether an identifier names a `createRebaseClient(...)` result declared in its file. */
function isFactoryResult(ctx: AstContext, identifier: Node): boolean {
    const { Node: N } = ctx.tsm;
    const declaration = identifier.getSymbol()?.getDeclarations()[0];
    if (!declaration || !N.isVariableDeclaration(declaration)) return false;
    let initializer: Node | undefined = declaration.getInitializer();
    while (initializer && (N.isAwaitExpression(initializer) || N.isAsExpression(initializer) || N.isParenthesizedExpression(initializer))) initializer = initializer.getExpression();
    return initializer !== undefined && N.isCallExpression(initializer) && initializer.getExpression().getText() === CLIENT_FACTORY;
}

/** The object literal a hooks argument denotes: written there, or a same-scope `const`. */
function hooksObject(ctx: AstContext, argument: Node): ObjectLiteralExpression | undefined {
    const { Node: N } = ctx.tsm;
    if (N.isObjectLiteralExpression(argument)) return argument;
    if (N.isIdentifier(argument)) {
        const declaration = argument.getSymbol()?.getDeclarations()[0];
        if (declaration && N.isVariableDeclaration(declaration)) {
            const initializer = declaration.getInitializer();
            return initializer ? resolveObject(ctx, initializer).node : undefined;
        }
    }
    return undefined;
}

/** Rewrite one function member in place (props renamed), returning its edit and its TODOs. */
function adaptFunctionMember(ctx: AstContext, member: Member, name: string, collectionIsValue: boolean): { edit?: { start: number; end: number; text: string }; todos: string[] } {
    const target = member.method ?? member.value;
    if (!target) return { todos: [] };
    const carried = carryHook(ctx, member, name, { collectionIsValue });
    const original = member.method ? undefined : nodeText(target);
    const indent = (() => {
        const full = target.getSourceFile().getFullText();
        const lineStart = full.lastIndexOf("\n", target.getStart() - 1) + 1;
        return /^[ \t]*/.exec(full.slice(lineStart, target.getStart()))?.[0] ?? "";
    })();
    if (original === carried.text) return { todos: carried.todos };
    if (member.method) {
        return { edit: { start: member.method.getStart(), end: member.method.getEnd(), text: `${member.method.getName()}: ${reindent(carried.text, indent)}` }, todos: carried.todos };
    }
    return { edit: { start: target.getStart(), end: target.getEnd(), text: reindent(carried.text, indent) }, todos: carried.todos };
}

/** The members of a hooks object that are functions, by name. */
function functionMembers(ctx: AstContext, object: ObjectLiteralExpression): { name: string; member: Member }[] {
    const { Node: N } = ctx.tsm;
    const out: { name: string; member: Member }[] = [];
    for (const property of object.getProperties()) {
        if (N.isMethodDeclaration(property)) out.push({ name: property.getName(), member: { node: property, method: property } });
        else if (N.isPropertyAssignment(property)) {
            const initializer = property.getInitializerOrThrow();
            if (N.isArrowFunction(initializer) || N.isFunctionExpression(initializer)) out.push({ name: property.getName(), member: { node: property, value: initializer } });
        }
    }
    return out;
}

/**
 * Which rule source an object literal is (rule 11), and so which of
 * {@link RULE_KEY_RENAMES} apply: the argument of an `existsIn(…)` call
 * (`policy.existsIn`, or the function imported bare) or a literal
 * `{ kind: "existsIn", … }`; or the value of a `membership:` property (a
 * tenant's membership source). Anything else is not a rule source.
 */
function ruleSourceOf(ctx: AstContext, object: ObjectLiteralExpression): keyof typeof RULE_KEY_RENAMES | undefined {
    const { Node: N } = ctx.tsm;
    const parent = object.getParent();
    if (parent && N.isCallExpression(parent) && parent.getArguments()[0] === object) {
        const callee = parent.getExpression();
        if ((N.isIdentifier(callee) && callee.getText() === "existsIn") ||
            (N.isPropertyAccessExpression(callee) && callee.getName() === "existsIn")) return "existsIn";
    }
    if (parent && N.isPropertyAssignment(parent) && parent.getInitializer() === object && parent.getName() === "membership") return "membership";
    const isExistsIn = object.getProperties().some(property => {
        if (!N.isPropertyAssignment(property) || property.getName() !== "kind") return false;
        const value = property.getInitializer();
        return value !== undefined && (N.isStringLiteral(value) || N.isNoSubstitutionTemplateLiteral(value)) && value.getLiteralValue() === "existsIn";
    });
    return isExistsIn ? "existsIn" : undefined;
}

/** Options of {@link rewriteSdkCalls}. */
export interface RewriteSdkOptions {
    /** Files to read instead of the ones on disk (what the migration is about to write). */
    overrides?: ReadonlyMap<string, string>;
    /** Directories not to read (the legacy `config/`, which is deleted after the migration). */
    skipDirs?: readonly string[];
    /** Module specifiers → files, for the type checker (the workspace's sources in-repo). */
    aliases?: Record<string, string>;
    /** The `backend/schema` directory a `collectionsDir` boot option becomes. */
    schemaDir?: string;
    /** The legacy collections directory, to recognise a `collectionsDir` that points at it. */
    collectionsDir?: string;
}

/**
 * Rewrite every source file of the project at `root`. Returns the new content
 * of each file that changed, and the report.
 */
export async function rewriteSdkCalls(root: string, options: RewriteSdkOptions = {}): Promise<{ files: Map<string, string>; report: SdkRewriteReport }> {
    const tsm: TsMorph = await import("ts-morph");
    const ctx = createAstContext(tsm);
    const oracle = new TypeOracle(tsm, root, options.aliases ?? {});
    const report: SdkRewriteReport = { files: [], counts: {}, left: [], manualSteps: [], notes: [], generated: [], typeAware: false };
    const out = new Map<string, string>();
    const files = new Set(sdkSourceFiles(root, options.skipDirs));
    for (const file of options.overrides?.keys() ?? []) if (SOURCE.test(file)) files.add(file);
    for (const file of [...files].sort()) {
        const text = options.overrides?.get(file) ?? fs.readFileSync(file, "utf8");
        const relative = toPosix(path.relative(root, file));
        if (isGeneratedSdkFile(file, text)) {
            if (/collection/i.test(text)) report.generated.push(relative);
            continue;
        }
        if (!/collection|Collection|COLLECTION/.test(text)) continue;
        const typed = oracle.sourceFile(file, text);
        const sf = typed ?? ctx.project.createSourceFile(file, text, { overwrite: true });
        const edits = rewriteFile(ctx, sf, oracle, typed !== undefined, relative, report, options);
        if (!typed) ctx.project.removeSourceFile(sf);
        const apply = (source: string, list: readonly Edit[]): string => {
            let next = source;
            for (const edit of [...list].sort((a, b) => b.start - a.start || b.end - a.end)) next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
            return next;
        };
        const afterFirst = apply(text, edits);
        const second = ctx.project.createSourceFile(file, afterFirst, { overwrite: true });
        const hookEdits = adaptHooks(ctx, second, relative, report);
        ctx.project.removeSourceFile(second);
        const all = [...edits, ...hookEdits];
        if (all.length > 0) {
            const next = apply(afterFirst, hookEdits);
            if (next !== text) {
                out.set(file, next);
                report.files.push({ path: relative, edits: all.length });
                for (const edit of all) report.counts[edit.rule] = (report.counts[edit.rule] ?? 0) + 1;
            }
        }
    }
    report.typeAware = oracle.used;
    if (report.generated.length > 0) {
        report.manualSteps.push({
            title: "Regenerate the typed SDK",
            detail: `${report.generated.join(", ")} ${report.generated.length > 1 ? "are" : "is"} generated SDK output from before the rename; the rewrite never edits generated files. Run \`rebase generate-sdk\` (with the same output path and options as before) to write ${report.generated.length > 1 ? "them" : "it"} again.`,
            snippet: "rebase generate-sdk"
        });
    }
    return { files: out, report };
}

function rewriteFile(
    ctx: AstContext,
    sf: SourceFile,
    oracle: TypeOracle,
    typed: boolean,
    relative: string,
    report: SdkRewriteReport,
    options: RewriteSdkOptions
): Edit[] {
    const { Node: N, SyntaxKind } = ctx.tsm;
    const edits: Edit[] = [];
    const taken = (start: number, end: number): boolean => edits.some(edit => start < edit.end && edit.start < end);
    const add = (node: Node, text: string, rule: SdkRule): void => {
        if (taken(node.getStart(), node.getEnd())) return;
        edits.push({ start: node.getStart(), end: node.getEnd(), text, rule });
    };
    // The type decides where there is one: a receiver typed as something else
    // (a structural interface of the project's own that only looks like the
    // SDK) is left, however it is spelled. Without a type, the list decides.
    const isSdk = (receiver: Node): boolean => {
        const byType = typed ? oracle.isSdkData(receiver) : undefined;
        if (byType !== undefined) return byType;
        return isListedReceiver(ctx, receiver);
    };

    // Imports: generated types (3), SDK type names (5), CollectionCallbacks with setTableHooks (9).
    const renamedLocals = new Map<string, string>();
    for (const declaration of sf.getImportDeclarations()) {
        const specifier = declaration.getModuleSpecifierValue();
        const generated = /database\.types(\.js)?$/.test(specifier);
        const rebase = specifier.startsWith("@rebasepro/");
        for (const named of declaration.getNamedImports()) {
            const imported = named.getName();
            const next = (generated ? own(GENERATED_TYPE_RENAMES, imported) : undefined) ?? (rebase ? own(TYPE_RENAMES, imported) : undefined);
            if (!next) continue;
            const alias = named.getAliasNode();
            add(named.getNameNode(), next, generated ? "generated-types" : "type-names");
            if (!alias) renamedLocals.set(imported, next);
        }
    }

    const setTableHookFiles = sf.getText().includes("setCollectionCallbacks");
    if (setTableHookFiles) {
        for (const declaration of sf.getImportDeclarations()) {
            if (!declaration.getModuleSpecifierValue().startsWith("@rebasepro/")) continue;
            for (const named of declaration.getNamedImports()) {
                if (named.getName() !== "CollectionCallbacks") continue;
                add(named.getNameNode(), "TableHooks", "table-hooks");
                if (!named.getAliasNode()) renamedLocals.set("CollectionCallbacks", "TableHooks");
            }
        }
    }

    for (const identifier of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
        const next = renamedLocals.get(identifier.getText());
        if (!next) continue;
        const parent = identifier.getParent();
        if (parent && (N.isImportSpecifier(parent) || (N.isPropertyAccessExpression(parent) && parent.getNameNode() === identifier) ||
            (N.isPropertyAssignment(parent) && parent.getNameNode() === identifier))) continue;
        add(identifier, next, own(GENERATED_TYPE_RENAMES, identifier.getText()) ? "generated-types" : identifier.getText() === "CollectionCallbacks" ? "table-hooks" : "type-names");
    }

    // String error codes (6).
    for (const literal of [...sf.getDescendantsOfKind(SyntaxKind.StringLiteral), ...sf.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral)]) {
        const next = own(ERROR_CODES, literal.getLiteralValue());
        if (next) add(literal, literal.getText().replace(literal.getLiteralValue(), next), "error-codes");
    }

    // Offline options (7), wherever they are spelled.
    for (const identifier of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
        const next = own(OFFLINE_OPTIONS, identifier.getText());
        if (next) add(identifier, next, "offline-options");
    }

    // Object literals: createRebaseClient options (2), batch operations (4), rule sources (11).
    for (const object of sf.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
        const parent = object.getParent();
        const isClientOptions = parent !== undefined && N.isCallExpression(parent) && parent.getExpression().getText() === CLIENT_FACTORY && parent.getArguments()[0] === object;
        const hasOp = object.getProperties().some(property => (N.isPropertyAssignment(property) || N.isShorthandPropertyAssignment(property)) && property.getName() === "op");
        const ruleSource = ruleSourceOf(ctx, object);
        const ruleRenames = ruleSource ? RULE_KEY_RENAMES[ruleSource] : undefined;
        for (const property of object.getProperties()) {
            if (!N.isPropertyAssignment(property) && !N.isShorthandPropertyAssignment(property)) continue;
            const name = property.getName();
            let next: string | undefined;
            let rule: SdkRule = "client-options";
            if (isClientOptions && name === "collections") next = "tables";
            else if (isClientOptions && name === "collectionsDictionary") next = "tablesDictionary";
            else if (hasOp && name === "collection") {
                next = "table";
                rule = "batch-op";
            } else if (ruleRenames && own(ruleRenames, name)) {
                next = own(ruleRenames, name);
                rule = "rule-vocabulary";
            }
            if (!next) continue;
            if (N.isShorthandPropertyAssignment(property)) add(property, `${next}: ${name}`, rule);
            else add(property.getNameNode(), next, rule);
        }
    }

    // Calls: .collection( (1), typed accessors (8), setCollectionCallbacks (9), boot options.
    for (const access of sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
        const name = access.getName();
        const receiver = access.getExpression();
        const parent = access.getParent();
        const isCall = parent !== undefined && N.isCallExpression(parent) && parent.getExpression() === access;
        if (name === "collection" && isCall) {
            if (isSdk(receiver)) add(access.getNameNode(), "table", "collection-call");
            else {
                report.left.push({
                    file: relative,
                    line: access.getStartLineNumber(),
                    code: parent.getText().split("\n")[0].slice(0, 120),
                    reason: typed ? "left unchanged: the receiver's type is not the SDK data surface" : "left unchanged: receiver not recognised"
                });
            }
            continue;
        }
        if (name === "collection" && !isCall && isSdk(receiver)) {
            // A reference to the method rather than a call: `typeof client.data.collection`,
            // `const open = context.data.collection`.
            add(access.getNameNode(), "table", "collection-call");
            continue;
        }
        if (/^[a-z]\w*Collection$/.test(name) && !isCall && isSdk(receiver)) {
            add(access.getNameNode(), name === "collectionCollection" ? "collection" : `${name.slice(0, -"Collection".length)}Table`, "typed-accessor");
            continue;
        }
        if (name === "setCollectionCallbacks" && isCall) {
            add(access.getNameNode(), "setTableHooks", "table-hooks");
            continue;
        }
    }

    // Boot options.
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const callee = call.getExpression().getText();
        if (callee !== "initializeRebaseBackend" && callee !== "createRebaseBackend") continue;
        bootOptions(ctx, call, relative, report, edits, options);
    }
    // `typeof client.data.collection`: the method named in a type query (rule 1).
    for (const qualified of sf.getDescendantsOfKind(SyntaxKind.QualifiedName)) {
        if (qualified.getRight().getText() !== "collection") continue;
        const left = qualified.getLeft();
        if (!N.isQualifiedName(left) || !DATA_PROPERTIES.has(left.getRight().getText())) continue;
        const owner = left.getLeft();
        const ownerName = N.isQualifiedName(owner) ? owner.getRight().getText() : owner.getText();
        if (RECEIVER_OWNERS.has(ownerName) || (N.isIdentifier(owner) && isFactoryResult(ctx, owner))) add(qualified.getRight(), "table", "collection-call");
    }
    return edits;
}

/**
 * The second pass, over the text the first one wrote: the hooks given to
 * `setTableHooks` (rule 9) and `storageAuthorize`'s data (rule 10) get their
 * props adapted. Run after the call-site renames so a hook's body already
 * reads `.table(` and its whole text can be replaced; a hook already adapted
 * is left as it is, so a second run changes nothing.
 */
function adaptHooks(ctx: AstContext, sf: SourceFile, relative: string, report: SdkRewriteReport): Edit[] {
    const { Node: N, SyntaxKind } = ctx.tsm;
    const edits: Edit[] = [];
    const taken = (start: number, end: number): boolean => edits.some(edit => start < edit.end && edit.start < end);
    for (const access of sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
        const parent = access.getParent();
        if (access.getName() !== "setTableHooks" || !parent || !N.isCallExpression(parent) || parent.getExpression() !== access) continue;
        const argument = parent.getArguments()[1];
        const object = argument ? hooksObject(ctx, argument) : undefined;
        if (!object) {
            report.manualSteps.push({
                title: `Adapt the hooks passed to setTableHooks in ${relative}`,
                detail: `Line ${access.getStartLineNumber()}: the hooks are not an object literal the codemod can read (\`${argument?.getText() ?? "?"}\`). Table hooks get \`table\` instead of \`collection\`, and afterRead / beforeDelete / afterDelete get \`values\` instead of \`row\`: adapt their parameters.`,
                file: relative
            });
            continue;
        }
        for (const { name: hook, member } of functionMembers(ctx, object)) {
            const adapted = adaptFunctionMember(ctx, member, hook, false);
            if (adapted.edit && !taken(adapted.edit.start, adapted.edit.end)) edits.push({ ...adapted.edit, rule: "table-hooks" });
            for (const todo of adapted.todos) {
                report.manualSteps.push({
                    title: `Check the ${hook} hook in ${relative}`,
                    detail: `${hook} ${todo} The line is marked \`TODO(rebase-migrate)\`.`,
                    file: relative
                });
            }
        }
    }
    // storageAuthorize's data (10).
    for (const declaration of sf.getVariableDeclarations()) {
        if (declaration.getName() !== "storageAuthorize") continue;
        const initializer = declaration.getInitializer();
        if (!initializer || !(N.isArrowFunction(initializer) || N.isFunctionExpression(initializer))) continue;
        const adapted = adaptFunctionMember(ctx, { node: declaration, value: initializer }, "storageAuthorize", true);
        if (adapted.edit && !taken(adapted.edit.start, adapted.edit.end)) edits.push({ ...adapted.edit, rule: "storage-authorize" });
    }

    return edits;
}

/** The boot options of a backend entry: the provable shape rewritten, the rest a manual step. */
function bootOptions(ctx: AstContext, call: CallExpression, relative: string, report: SdkRewriteReport, edits: Edit[], options: RewriteSdkOptions): void {
    const { Node: N } = ctx.tsm;
    const object = call.getArguments()[0];
    if (!object || !N.isObjectLiteralExpression(object)) return;
    const legacy: string[] = [];
    for (const property of object.getProperties()) {
        if (!N.isPropertyAssignment(property) && !N.isShorthandPropertyAssignment(property)) continue;
        const name = property.getName();
        if (name === "collectionsDir" && N.isPropertyAssignment(property) && options.schemaDir && options.collectionsDir) {
            const value = property.getInitializerOrThrow();
            if (N.isCallExpression(value) && /^path\.(join|resolve)$/.test(value.getExpression().getText())) {
                const args = value.getArguments();
                const base = args[0]?.getText();
                const rest = args.slice(1);
                if ((base === "__dirname" || base === "import.meta.dirname") && rest.length > 0 && rest.every(arg => N.isStringLiteral(arg))) {
                    const from = path.dirname(path.join(path.dirname(call.getSourceFile().getFilePath()), "x"));
                    const pointed = path.resolve(from, ...rest.map(arg => (N.isStringLiteral(arg) ? arg.getLiteralValue() : "")));
                    if (path.resolve(pointed) === path.resolve(options.collectionsDir)) {
                        const next = toPosix(path.relative(from, options.schemaDir));
                        edits.push({ start: property.getStart(), end: property.getEnd(), text: `schemaDir: ${value.getExpression().getText()}(${base}, ${JSON.stringify(next)})`, rule: "boot-options" });
                        continue;
                    }
                }
            }
            legacy.push(name);
            continue;
        }
        if (name === "collections" || name === "callbacks" || name === "collectionsDir") legacy.push(name);
        if (name === "auth" && N.isPropertyAssignment(property)) {
            const auth = property.getInitializerOrThrow();
            if (N.isObjectLiteralExpression(auth) && auth.getProperty("collection")) legacy.push("auth.collection");
        }
    }
    if (legacy.length === 0) return;
    report.manualSteps.push({
        title: `Update the backend options in ${relative}`,
        detail: `Line ${call.getStartLineNumber()}: ${legacy.map(name => `\`${name}\``).join(", ")} belong to the collection model. Pass the tables instead — \`schemaDir\` (the directory whose index exports them) or \`tables\` + \`defaultRls\` imported from backend/schema; \`hooks\` (backend/hooks.ts) for global hooks; the auth table is the one defined with \`defineAuthTable\`, so \`auth.collection\` goes.`,
        snippet: `${call.getExpression().getText()}({\n    schemaDir: path.join(__dirname, "<relative path to backend/schema>"),\n    // or: tables: Object.values(await import("<backend/schema>")), defaultRls,\n    // hooks,              (from backend/hooks.ts, if you had global callbacks)\n    // auth: { … },        (without \`collection\`)\n    …\n})`,
        file: relative
    });
}
