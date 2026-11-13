import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    Node,
    Project,
    type ArrayLiteralExpression,
    type ImportDeclaration,
    type ObjectLiteralExpression,
    type SourceFile,
    type VariableDeclaration,
    type VariableStatement
} from "ts-morph";
import {
    ColumnBuilder,
    col,
    columnDefFromWire,
    defineTable,
    rel,
    type AnyTableDef,
    type AnyViewDef,
    type ColumnDef,
    type ColumnsShape,
    type CompiledTable,
    type DefaultRls,
    type NewTable,
    type RelationDef,
    type RelationsShape,
    type TableDescriptor,
    type TablePatch,
    type TableThunk,
    type WireColumnDef,
    type WireRelation
} from "@rebasepro/types";
import {
    DEFAULT_SCHEMA_SPECIFIER,
    TABLE_KEY_ORDER,
    enumIdentifier,
    isSchemaDefinitionError,
    printColumn,
    printIndexModule,
    printRelation,
    printRls,
    printSchemaValue,
    printTableModule,
    tableIdentifier
} from "@rebasepro/common";

import { compileSchemaDefs, isSchemaLoadError, loadBackendSchema } from "../schema/load-schema";
import { createSourceImporter } from "../schema-edit/source-importer";
import {
    applyEdits,
    deeper,
    insertListItem,
    itemText,
    listShape,
    reindent,
    removeListItem,
    removeStatement,
    replaceNode,
    type TextEdit
} from "../schema-edit/source-text";

/**
 * The Studio's schema editor: edits to `backend/schema/*.ts`, one
 * {@link TablePatch} at a time.
 *
 * It reads and writes the `defineTable` / `defineAuthTable` / `defineView`
 * calls the schema's index exports — their `columns` (each a `col.*` chain),
 * `relations` (`rel.*`), `rls` and table-level keys — and nothing else. Every
 * piece of text it writes comes from the one printer (`printColumn`,
 * `printRelation`, `printRls`, `printTableModule`…), and it writes by splicing
 * that text in at the position of what it replaces, so everything it does not
 * rewrite stays byte for byte: comments, hooks, `.transform()` bodies, the
 * other columns, the other rules.
 *
 * What it cannot read with confidence — a config that spreads another object,
 * a column built by a helper, rules held in a variable, a key computed at run
 * time — it calls *edited in code*: {@link TableSourceEditor.describe} reports
 * it read-only, and an edit that would write there is refused with the reason,
 * never guessed at.
 *
 * Every edit is applied to a copy of the text first and the result is
 * compiled — imported as it would be, through {@link loadBackendSchema} — and
 * an edit whose result does not compile is refused with the problems, having
 * written nothing.
 *
 * One edit at a time ({@link TableSourceEditor.run}): the source-only routes
 * and live schema editing's `/apply` share one editor per process, so an edit
 * never reads files another edit is halfway through writing.
 *
 * @group Schema
 */
export class TableSourceEditor {
    private settled: Promise<unknown> = Promise.resolve();
    readonly schemaDir: string;
    private readonly resolveBareFrom?: string;

    constructor(schemaDir: string, options: { resolveBareFrom?: string } = {}) {
        this.schemaDir = path.resolve(schemaDir);
        this.resolveBareFrom = options.resolveBareFrom;
    }

    /** Run `work` once every edit queued before it has finished. */
    run<T>(work: () => Promise<T>): Promise<T> {
        const result = this.settled.then(work);
        this.settled = result.then(() => undefined, () => undefined);
        return result;
    }

    /**
     * Apply `patches` to a copy of the schema's text and compile the result.
     * Writes nothing: the edit is refused (a {@link TableSourceEditError}) or
     * returned, with every file it changed and the schema it compiles to.
     */
    async preview(patches: readonly TablePatch[]): Promise<TableSourceEdit> {
        const workspace = Workspace.read(this.schemaDir);
        for (const [index, patch] of patches.entries()) {
            try {
                await applyPatch(workspace, patch, this);
            } catch (error) {
                throw asRefusal(error, index, patch);
            }
        }
        const files = workspace.changes();
        if (files.length === 0) {
            throw new TableSourceEditError("SCHEMA_EDIT_REFUSED", "The edit changes nothing in backend/schema.", []);
        }
        const schema = await this.compile(workspace.texts());
        return { files, schema };
    }

    /** {@link preview}, then write the files — queued behind every other edit. */
    apply(patches: readonly TablePatch[]): Promise<TableSourceEdit> {
        return this.run(async () => {
            const edit = await this.preview(patches);
            await this.write(edit);
            return edit;
        });
    }

    /**
     * Write a previewed edit's files, refusing when one of them changed on
     * disk since the preview read it (an IDE save, another process): the edit
     * was made against the old text.
     */
    async write(edit: TableSourceEdit): Promise<void> {
        this.assertUnchanged(edit);
        for (const file of edit.files) {
            if (file.deleted) {
                await fsp.rm(file.path, { force: true });
            } else {
                await fsp.mkdir(path.dirname(file.path), { recursive: true });
                await fsp.writeFile(file.path, file.contents, "utf8");
            }
        }
    }

    /** Refuse when a file an edit rewrites is no longer what the edit read. */
    assertUnchanged(edit: TableSourceEdit): void {
        for (const file of edit.files) {
            const now = fs.existsSync(file.path) ? fs.readFileSync(file.path, "utf8") : undefined;
            if (now !== file.before) {
                throw new TableSourceEditError(
                    "SCHEMA_EDIT_STALE_FILE",
                    `${file.path} changed since the edit was prepared (it was saved by something else meanwhile). ` +
                    "Nothing was written: make the edit again against the file as it is now.",
                    []
                );
            }
        }
    }

    /**
     * Every table the schema's index exports, as the editor reads it: which
     * parts it can write, and why not where it cannot.
     */
    async describe(): Promise<TableSourceSummary[]> {
        return Workspace.read(this.schemaDir).tables().map(summarize);
    }

    /** The schema directory as it is on disk, compiled: the tables `backend/schema` declares now. */
    async compileCurrent(): Promise<EditedSchema> {
        return this.compile(Workspace.read(this.schemaDir).texts());
    }

    /** Compile the schema directory as `texts` would make it. */
    async compile(texts: ReadonlyMap<string, string>): Promise<EditedSchema> {
        const scratch = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "rebase-schema-edit-")));
        try {
            for (const [file, text] of texts) {
                const target = path.join(scratch, path.relative(this.schemaDir, file));
                await fsp.mkdir(path.dirname(target), { recursive: true });
                await fsp.writeFile(target, text, "utf8");
            }
            const importModule = createSourceImporter({
                sources: texts,
                realDir: this.schemaDir,
                scratchDir: scratch,
                ...(this.resolveBareFrom ? { resolveBareFrom: this.resolveBareFrom } : {})
            });
            const loaded = await loadBackendSchema(scratch, { projectRoot: false, importModule });
            const compiled = compileSchemaDefs(loaded.defs, loaded.defaultRls);
            return { defs: loaded.defs, ...(loaded.defaultRls !== undefined ? { defaultRls: loaded.defaultRls } : {}), ...compiled };
        } catch (error) {
            throw compileRefusal(error, scratch, this.schemaDir);
        } finally {
            await fsp.rm(scratch, { recursive: true, force: true });
        }
    }
}

/**
 * One file an edit changed.
 *
 * @group Schema
 */
export interface TableSourceFile {
    /** Absolute path. */
    path: string;
    /** The new text. Empty for a deleted file. */
    contents: string;
    /** The edit deletes the file. */
    deleted?: true;
    /** The text the edit was made against; `undefined` for a file it creates. */
    before?: string;
}

/**
 * A schema as an edit leaves it: the definitions, and what they compile and
 * lower to — what a running server is refreshed with after an apply.
 *
 * @group Schema
 */
export interface EditedSchema {
    defs: (AnyTableDef | AnyViewDef)[];
    defaultRls?: DefaultRls;
    /**
     * The definitions compiled, as boot compiles its own: each descriptor
     * with its hooks, transforms and auth hooks — what the planner plans from
     * and what the server's registries serve after an apply.
     */
    tables: CompiledTable[];
    descriptors: TableDescriptor[];
}

/**
 * An edit, applied to a copy and compiled.
 *
 * @group Schema
 */
export interface TableSourceEdit {
    /** Every file the edit changes, in path order. */
    files: TableSourceFile[];
    /** What the schema compiles to with the edit. */
    schema: EditedSchema;
}

/**
 * What is wrong with an edit, or with what it would leave.
 *
 * @group Schema
 */
export interface TableSourceProblem {
    /** The table, by slug or name. */
    table: string;
    /** The column, relation or key, when there is one. */
    key?: string;
    message: string;
}

/**
 * Why the schema editor refused an edit:
 *
 * - `SCHEMA_EDIT_REFUSED` — the edit cannot be made as asked: the table is
 *   edited in code there, the column does not exist, a slug rename.
 * - `SCHEMA_EDIT_DOES_NOT_COMPILE` — the edit can be made, and the schema it
 *   leaves would not load: the problems say why.
 * - `SCHEMA_EDIT_STALE_FILE` — a file the edit rewrites changed on disk since
 *   the edit was prepared (an IDE save, another process): reload it and make
 *   the edit again.
 *
 * @group Schema
 */
export type SchemaEditRefusalCode = "SCHEMA_EDIT_REFUSED" | "SCHEMA_EDIT_DOES_NOT_COMPILE" | "SCHEMA_EDIT_STALE_FILE";

/**
 * An edit the schema editor will not make, with its
 * {@link SchemaEditRefusalCode}. Nothing was written.
 *
 * @group Schema
 */
export class TableSourceEditError extends Error {
    constructor(
        readonly code: SchemaEditRefusalCode,
        message: string,
        readonly problems: readonly TableSourceProblem[]
    ) {
        super(message);
        this.name = "TableSourceEditError";
    }
}

/**
 * How the editor reads one table.
 *
 * @group Schema
 */
export interface TableSourceSummary {
    slug: string;
    name: string;
    kind: "table" | "authTable" | "view";
    /** The file holding it, absolute. */
    file: string;
    /** Why the table is read-only as a whole, when it is. */
    editedInCode?: string;
    /** Every column, and why one is read-only. */
    columns: { key: string; editedInCode?: string }[];
    /** Every relation, and why one is read-only. */
    relations: { name: string; editedInCode?: string }[];
    /** Why `rls` (or its rules) cannot be written, when it cannot. */
    rlsEditedInCode?: string;
}

// ── Reading the schema ──────────────────────────────────────────────────────

const MODULE_EXTENSIONS = [".ts", ".mts", ".js", ".mjs"];
const INDEX_FILES = ["index.ts", "index.mts", "index.js", "index.mjs"];
const BUILDERS = new Set(["defineTable", "defineAuthTable", "defineView"]);
type BuilderName = "defineTable" | "defineAuthTable" | "defineView";

/** The module files of a schema directory, as the loader lists them. */
function moduleFiles(dir: string): string[] {
    const out: string[] = [];
    if (!fs.existsSync(dir)) return out;
    const walk = (current: string): void => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "__tests__") continue;
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile() && MODULE_EXTENSIONS.some(ext => entry.name.endsWith(ext))
                && !/\.d\.[mc]?ts$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
                out.push(full);
            }
        }
    };
    walk(dir);
    return out.sort();
}

/** A table the index exports, located in its file. */
interface LocatedTable {
    slug: string;
    name: string;
    builder: BuilderName;
    /** Absolute path of the file declaring it. */
    file: string;
    /** The `const` it is bound to in that file. */
    variable: string;
    /** The name the index exports it under. */
    exportName: string;
    declaration: VariableDeclaration;
    /** The config object, when the editor can write it. */
    config?: ObjectLiteralExpression;
    /** Why it cannot, when it cannot. */
    editedInCode?: string;
}

/** The text of the schema directory during one edit. */
class Workspace {
    private readonly current = new Map<string, string>();
    private readonly original = new Map<string, string>();
    private project?: Project;

    private constructor(readonly dir: string) {}

    static read(dir: string): Workspace {
        const workspace = new Workspace(dir);
        for (const file of moduleFiles(dir)) {
            const text = fs.readFileSync(file, "utf8");
            workspace.current.set(file, text);
            workspace.original.set(file, text);
        }
        return workspace;
    }

    texts(): ReadonlyMap<string, string> {
        return this.current;
    }

    has(file: string): boolean {
        return this.current.has(file);
    }

    text(file: string): string {
        const text = this.current.get(file);
        if (text === undefined) throw new Error(`${file} is not a module of ${this.dir}.`);
        return text;
    }

    set(file: string, text: string): void {
        this.current.set(file, text);
        this.project = undefined;
    }

    edit(file: string, edits: readonly TextEdit[]): void {
        if (edits.length > 0) this.set(file, applyEdits(this.text(file), edits));
    }

    delete(file: string): void {
        this.current.delete(file);
        this.project = undefined;
    }

    /** Every file whose text differs from what was read, in path order. */
    changes(): TableSourceFile[] {
        const out: TableSourceFile[] = [];
        for (const [file, text] of this.current) {
            const before = this.original.get(file);
            if (before !== text) out.push({ path: file, contents: text, ...(before !== undefined ? { before } : {}) });
        }
        for (const [file, before] of this.original) {
            if (!this.current.has(file)) out.push({ path: file, contents: "", deleted: true, before });
        }
        return out.sort((a, b) => a.path.localeCompare(b.path));
    }

    /** The current text parsed; rebuilt after every change, so nodes are never stale. */
    source(file: string): SourceFile {
        const project = this.parsed();
        const source = project.getSourceFile(file);
        if (!source) throw new Error(`${file} is not a module of ${this.dir}.`);
        return source;
    }

    private parsed(): Project {
        if (this.project) return this.project;
        const project = new Project({
            useInMemoryFileSystem: true,
            compilerOptions: { allowJs: true, noLib: true }
        });
        for (const [file, text] of this.current) project.createSourceFile(file, text, { overwrite: true });
        this.project = project;
        return project;
    }

    indexFile(): string | undefined {
        return INDEX_FILES.map(name => path.join(this.dir, name)).find(file => this.current.has(file));
    }

    /** Every table the index exports, each once. */
    tables(): LocatedTable[] {
        const indexPath = this.indexFile();
        if (!indexPath) return [];
        const index = this.source(indexPath);
        const out: LocatedTable[] = [];
        const seen = new Set<VariableDeclaration>();
        for (const [exportName, declarations] of index.getExportedDeclarations()) {
            for (const declaration of declarations) {
                if (!Node.isVariableDeclaration(declaration) || seen.has(declaration)) continue;
                const located = locate(declaration, exportName);
                if (located) {
                    seen.add(declaration);
                    out.push(located);
                }
            }
        }
        return out;
    }

    table(slug: string): LocatedTable {
        const found = this.tables().find(table => table.slug === slug);
        if (!found) {
            throw refusal(
                `No table with the slug "${slug}" is exported from ${path.join(path.basename(this.dir), "index")} as a ` +
                "`defineTable` / `defineAuthTable` / `defineView` call the editor can read. If it is defined through a " +
                "helper or a variable, it is edited in code.",
                slug
            );
        }
        return found;
    }

    /** The table at `slug`, with a config the editor may write. */
    writable(slug: string): LocatedTable & { config: ObjectLiteralExpression } {
        const table = this.table(slug);
        if (!table.config) throw refusal(`Table "${slug}" is edited in code: ${table.editedInCode}`, slug);
        return { ...table, config: table.config };
    }
}

export function unwrapExpression(node: Node | undefined): Node | undefined {
    let current = node;
    while (current && (Node.isParenthesizedExpression(current) || Node.isAsExpression(current) ||
        Node.isSatisfiesExpression(current) || Node.isNonNullExpression(current) || Node.isTypeAssertion(current))) {
        current = current.getExpression();
    }
    return current;
}

export function literalString(node: Node | undefined): string | undefined {
    if (node && (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node))) return node.getLiteralValue();
    return undefined;
}

/** The key a member of an object literal is written under, when it is written literally. */
export function memberName(member: Node): string | undefined {
    if (Node.isPropertyAssignment(member) || Node.isShorthandPropertyAssignment(member) || Node.isMethodDeclaration(member)) {
        const nameNode = member.getNameNode();
        if (Node.isIdentifier(nameNode)) return nameNode.getText();
        if (Node.isStringLiteral(nameNode) || Node.isNoSubstitutionTemplateLiteral(nameNode)) return nameNode.getLiteralValue();
        if (Node.isNumericLiteral(nameNode)) return nameNode.getText();
    }
    return undefined;
}

/** Why an object literal's members cannot be read one by one, when they cannot. */
export function opaqueMembers(object: ObjectLiteralExpression, what: string): string | undefined {
    for (const member of object.getProperties()) {
        if (Node.isSpreadAssignment(member)) return `${what} spreads \`${member.getExpression().getText()}\`, so any key may come from code.`;
        if (memberName(member) === undefined) return `${what} has a key computed at run time (\`${member.getText().split(":")[0].trim()}\`).`;
    }
    return undefined;
}

/** A member of an object literal: its assignment, or why it cannot be written. */
export type Member =
    | { kind: "absent" }
    | { kind: "written"; node: Node; value: Node; index: number }
    | { kind: "code"; reason: string };

export function member(object: ObjectLiteralExpression, key: string, what: string): Member {
    const members = object.getProperties();
    const opaque = opaqueMembers(object, what);
    for (const [index, each] of members.entries()) {
        if (memberName(each) !== key) continue;
        if (Node.isPropertyAssignment(each)) {
            const value = each.getInitializer();
            if (value) return { kind: "written", node: each, value, index };
        }
        return { kind: "code", reason: `\`${key}\` of ${what} is ${Node.isShorthandPropertyAssignment(each) ? "a variable" : "a method"}.` };
    }
    if (opaque) return { kind: "code", reason: opaque };
    return { kind: "absent" };
}

function locate(declaration: VariableDeclaration, exportName: string): LocatedTable | undefined {
    const call = unwrapExpression(declaration.getInitializer());
    if (!call || !Node.isCallExpression(call)) return undefined;
    const callee = call.getExpression().getText().split(".").pop() ?? "";
    if (!BUILDERS.has(callee)) return undefined;
    const builder: BuilderName = callee === "defineAuthTable" ? "defineAuthTable" : callee === "defineView" ? "defineView" : "defineTable";
    const [nameArg, configArg] = call.getArguments();
    const name = literalString(nameArg);
    if (name === undefined) return undefined;
    const base = {
        name,
        builder,
        file: declaration.getSourceFile().getFilePath(),
        variable: declaration.getName(),
        exportName,
        declaration
    };
    const config = unwrapExpression(configArg);
    if (!config || !Node.isObjectLiteralExpression(config)) {
        return { ...base, slug: name, editedInCode: "its config is not an object literal written in the call." };
    }
    const opaque = opaqueMembers(config, "its config");
    const slugMember = member(config, "slug", "its config");
    if (slugMember.kind === "written") {
        const slug = literalString(slugMember.value);
        if (slug === undefined) return { ...base, slug: name, editedInCode: "its `slug` is not a string literal." };
        return opaque ? { ...base, slug, editedInCode: opaque } : { ...base, slug, config };
    }
    return opaque ? { ...base, slug: name, editedInCode: opaque } : { ...base, slug: name, config };
}

/** Whether a node is a builder chain rooted at `root`: `col.text().notNull()`, `rel.belongsTo(…)`. */
function isChainOf(node: Node, root: string): boolean {
    let current: Node | undefined = unwrapExpression(node);
    let calls = 0;
    while (current) {
        if (Node.isCallExpression(current)) {
            calls++;
            current = current.getExpression();
        } else if (Node.isPropertyAccessExpression(current)) {
            current = current.getExpression();
        } else {
            return calls > 0 && Node.isIdentifier(current) && current.getText() === root;
        }
    }
    return false;
}

/** The links of a chain, outermost last: `col.text().notNull()` → `[text(), notNull()]`. */
function chainLinks(node: Node): { name: string; args: Node[] }[] {
    const links: { name: string; args: Node[] }[] = [];
    let current: Node | undefined = unwrapExpression(node);
    while (current && Node.isCallExpression(current)) {
        const callee = current.getExpression();
        if (!Node.isPropertyAccessExpression(callee)) break;
        links.unshift({ name: callee.getName(), args: current.getArguments() });
        current = callee.getExpression();
    }
    return links;
}

/** One `const <identifier> = pgEnum("<name>", [...])` of a schema file. */
interface EnumBinding {
    identifier: string;
    enumName: string;
    values: string[];
}

/**
 * The `pgEnum` declarations of a file, by the identifier they are bound to: a
 * column chain may be rooted at one of them (`status: postStatus().notNull()`)
 * as well as at `col`. Only declarations the editor can read — a literal name
 * and a literal list of labels — count; anything else leaves the columns that
 * use it edited in code.
 */
function enumBindings(source: SourceFile): Map<string, EnumBinding> {
    const local = builderImport(source)?.local.get("pgEnum") ?? "pgEnum";
    const out = new Map<string, EnumBinding>();
    for (const statement of source.getVariableStatements()) {
        for (const declaration of statement.getDeclarations()) {
            const call = unwrapExpression(declaration.getInitializer());
            if (!call || !Node.isCallExpression(call) || call.getExpression().getText() !== local) continue;
            const [nameArg, valuesArg] = call.getArguments();
            const enumName = literalString(nameArg);
            const list = unwrapExpression(valuesArg);
            if (enumName === undefined || !list || !Node.isArrayLiteralExpression(list)) continue;
            const values = list.getElements().map(element => literalString(element));
            if (values.some(value => value === undefined)) continue;
            out.set(declaration.getName(), { identifier: declaration.getName(), enumName, values: values.filter((value): value is string => value !== undefined) });
        }
    }
    return out;
}

/** Whether a node is a column chain: rooted at `col`, or at a `pgEnum` binding of its file. */
function isColumnChain(node: Node): boolean {
    if (isChainOf(node, "col")) return true;
    let root: Node | undefined = unwrapExpression(node);
    while (root && (Node.isCallExpression(root) || Node.isPropertyAccessExpression(root))) root = root.getExpression();
    return root !== undefined && Node.isIdentifier(root) && enumBindings(node.getSourceFile()).has(root.getText()) && isChainOf(node, root.getText());
}

/** Why a column's value cannot be rewritten, when it cannot. */
function columnCode(value: Node, key: string): string | undefined {
    if (!isColumnChain(value)) {
        return `column "${key}" is not a \`col.*\` chain or a \`pgEnum\` column (it is built by \`${value.getText().slice(0, 40)}\`).`;
    }
    return undefined;
}

/** The source of the `.transform(…)` written on a column's own chain, and whether one hides deeper in it. */
function columnTransforms(value: Node): { own?: string; nested: boolean } {
    const links = chainLinks(value);
    const ownLink = links.find(link => link.name === "transform");
    const own = ownLink?.args[0]?.getText();
    let total = 0;
    value.forEachDescendant(node => {
        if (Node.isCallExpression(node)) {
            const callee = node.getExpression();
            if (Node.isPropertyAccessExpression(callee) && callee.getName() === "transform") total++;
        }
    });
    return { ...(own !== undefined ? { own } : {}), nested: total > (ownLink ? 1 : 0) };
}

function summarize(table: LocatedTable): TableSourceSummary {
    const kind = table.builder === "defineAuthTable" ? "authTable" : table.builder === "defineView" ? "view" : "table";
    const summary: TableSourceSummary = { slug: table.slug, name: table.name, kind, file: table.file, columns: [], relations: [] };
    if (!table.config) return { ...summary, editedInCode: table.editedInCode };
    const listOf = (key: string, what: string, rootName: string) => {
        const found = member(table.config!, key, "the config");
        if (found.kind !== "written") return { entries: [], reason: found.kind === "code" ? found.reason : undefined };
        const object = unwrapExpression(found.value);
        if (!object || !Node.isObjectLiteralExpression(object)) return { entries: [], reason: `\`${key}\` is not an object literal.` };
        const opaque = opaqueMembers(object, `\`${key}\``);
        const entries = object.getProperties().flatMap(each => {
            const entryKey = memberName(each);
            if (entryKey === undefined) return [];
            const value = Node.isPropertyAssignment(each) ? each.getInitializer() : undefined;
            const reason = opaque
                ?? (!value ? `${what} "${entryKey}" is a variable.` : rootName === "col" ? columnCode(value, entryKey)
                    : isChainOf(value, "rel") ? undefined : `${what} "${entryKey}" is not a \`rel.*\` call.`);
            return [{ key: entryKey, ...(reason ? { editedInCode: reason } : {}) }];
        });
        return { entries, reason: opaque };
    };
    const columns = listOf("columns", "column", "col");
    const relations = listOf("relations", "relation", "rel");
    const rls = member(table.config, "rls", "the config");
    let rlsEditedInCode: string | undefined;
    if (rls.kind === "code") rlsEditedInCode = rls.reason;
    if (rls.kind === "written") {
        const value = unwrapExpression(rls.value);
        if (!value || !(Node.isStringLiteral(value) || Node.isArrayLiteralExpression(value))) rlsEditedInCode = "`rls` is not written in the call.";
        else if (Node.isArrayLiteralExpression(value) && value.getElements().some(element => Node.isSpreadElement(element))) {
            rlsEditedInCode = "`rls` spreads another list of rules.";
        }
    }
    return {
        ...summary,
        columns: columns.entries.map(({ key, editedInCode }) => ({ key, ...(editedInCode ? { editedInCode } : {}) })),
        relations: relations.entries.map(({ key, editedInCode }) => ({ name: key, ...(editedInCode ? { editedInCode } : {}) })),
        ...(rlsEditedInCode ? { rlsEditedInCode } : {})
    };
}

// ── Writing ─────────────────────────────────────────────────────────────────

/** An edit refused, naming the table and, where there is one, the key. */
function refusal(message: string, table: string, key?: string): TableSourceEditError {
    return new TableSourceEditError("SCHEMA_EDIT_REFUSED", message, [{ table, ...(key !== undefined ? { key } : {}), message }]);
}

function asRefusal(error: unknown, index: number, patch: TablePatch): TableSourceEditError {
    if (error instanceof TableSourceEditError) return error;
    const table = patch.op === "createTable" ? patch.table.name : patch.op === "adoptTable" ? patch.table.slug : patch.table;
    const message = error instanceof Error ? error.message : String(error);
    return refusal(`Edit ${index} (${patch.op} on "${table}"): ${message}`, table);
}

function compileRefusal(error: unknown, scratch: string, dir: string): TableSourceEditError {
    if (error instanceof TableSourceEditError) return error;
    const real = (text: string): string => text.split(scratch).join(dir);
    if (isSchemaDefinitionError(error)) {
        return new TableSourceEditError(
            "SCHEMA_EDIT_DOES_NOT_COMPILE",
            `The edit was not written: ${real(error.message)}`,
            error.problems.map(problem => ({ table: problem.table, ...(problem.key !== undefined ? { key: problem.key } : {}), message: real(problem.message) }))
        );
    }
    const message = error instanceof Error ? real(error.message) : String(error);
    return new TableSourceEditError(
        "SCHEMA_EDIT_DOES_NOT_COMPILE",
        isSchemaLoadError(error) ? `The edit was not written: ${message}` : `The edit was not written: the schema it leaves does not load: ${message}`,
        [{ table: "", message }]
    );
}

export const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
export const printKey = (key: string): string => (IDENTIFIER.test(key) ? key : JSON.stringify(key));

/** The builder import of a file: the import declaration naming `defineTable` & co. */
function builderImport(source: SourceFile): { declaration: ImportDeclaration; local: Map<string, string> } | undefined {
    for (const declaration of source.getImportDeclarations()) {
        const named = declaration.getNamedImports();
        const local = new Map(named.map(element => [element.getName(), element.getAliasNode()?.getText() ?? element.getName()]));
        if ([...BUILDERS, "col", "rel"].some(name => local.has(name)) && !declaration.isTypeOnly()) return { declaration, local };
    }
    return undefined;
}

/** Add the builders `printed` text uses (`col`, `rel`, `json`, `sql`, `pgEnum`) to the file's builder import. */
function ensureBuilders(workspace: Workspace, file: string, needed: readonly ("col" | "rel" | "json" | "sql" | "pgEnum")[]): void {
    const source = workspace.source(file);
    const found = builderImport(source);
    if (!found) {
        throw refusal(`${file} has no import of the schema builders (\`defineTable\`, \`col\`…) to add ${needed.join(", ")} to.`, path.basename(file));
    }
    const missing: string[] = [];
    for (const name of needed) {
        const local = found.local.get(name);
        if (local === undefined) missing.push(name);
        else if (local !== name) {
            throw refusal(`${file} imports \`${name}\` as \`${local}\`; the editor writes \`${name}.…\`. Import it under its own name.`, path.basename(file));
        }
    }
    if (missing.length === 0) return;
    const named = found.declaration.getNamedImports();
    const last = named[named.length - 1];
    workspace.edit(file, [{ start: last.getEnd(), end: last.getEnd(), text: missing.map(name => `, ${name}`).join("") }]);
}

/** The module specifier `from` imports `to` by: `./users`, `../shared/users`. */
function relativeSpecifier(from: string, to: string): string {
    const relative = path.relative(path.dirname(from), to).split(path.sep).join("/").replace(/\.[mc]?[jt]s$/, "");
    return relative.startsWith(".") ? relative : `./${relative}`;
}

/** How `file` refers to `target`'s table, and the import it needs for that. */
function bindingFor(workspace: Workspace, file: string, target: LocatedTable): string {
    if (target.file === file) return target.variable;
    const source = workspace.source(file);
    for (const declaration of source.getImportDeclarations()) {
        if (declaration.getModuleSpecifierSourceFile()?.getFilePath() !== target.file) continue;
        const element = declaration.getNamedImports().find(each => each.getName() === target.variable);
        if (element) return element.getAliasNode()?.getText() ?? element.getName();
        const named = declaration.getNamedImports();
        if (named.length > 0 && !declaration.isTypeOnly()) {
            const last = named[named.length - 1];
            workspace.edit(file, [{ start: last.getEnd(), end: last.getEnd(), text: `, ${target.variable}` }]);
            return target.variable;
        }
    }
    const imports = source.getImportDeclarations();
    const line = `import { ${target.variable} } from ${JSON.stringify(relativeSpecifier(file, target.file))};`;
    const at = imports.length > 0 ? imports[imports.length - 1].getEnd() : 0;
    workspace.edit(file, [{ start: at, end: at, text: imports.length > 0 ? `\n${line}` : `${line}\n` }]);
    return target.variable;
}

/** Drop the import of `identifier` from a file when nothing in it refers to it any more. */
function dropUnusedImport(workspace: Workspace, file: string, identifier: string): void {
    const source = workspace.source(file);
    const used = source.getDescendants().some(node =>
        Node.isIdentifier(node) && node.getText() === identifier && !node.getFirstAncestor(Node.isImportDeclaration));
    if (used) return;
    for (const declaration of source.getImportDeclarations()) {
        const named = declaration.getNamedImports();
        const index = named.findIndex(element => (element.getAliasNode()?.getText() ?? element.getName()) === identifier);
        if (index === -1) continue;
        if (named.length === 1 && !declaration.getDefaultImport() && !declaration.getNamespaceImport()) {
            const statements = source.getStatements();
            const position = statements.indexOf(declaration);
            workspace.edit(file, [removeStatement(source.getFullText(), declaration, position > 0 ? statements[position - 1].getEnd() : 0)]);
        } else {
            const element = named[index];
            const edit: TextEdit = index < named.length - 1
                ? { start: element.getStart(), end: named[index + 1].getStart(), text: "" }
                : { start: named[index - 1]?.getEnd() ?? element.getStart(), end: element.getEnd(), text: "" };
            workspace.edit(file, [edit]);
        }
        return;
    }
}

/** The identifier a relation's thunk returns: `() => users` → `users`. */
function thunkTarget(value: Node): string | undefined {
    const call = unwrapExpression(value);
    if (!call || !Node.isCallExpression(call)) return undefined;
    const thunk = call.getArguments()[0];
    if (!thunk || !Node.isArrowFunction(thunk)) return undefined;
    const body = unwrapExpression(thunk.getBody());
    return body && Node.isIdentifier(body) ? body.getText() : undefined;
}

/** A stand-in the printer reads a relation's target from: its name and slug, nothing else. */
function targetStandIn(name: string, slug: string): AnyTableDef {
    return defineTable(name, { slug, columns: { id: col.uuid().primaryKey() }, rls: "admin-only" });
}

/** A wire relation as the `rel.*` result it describes, pointing at `target`. */
function relationFromWire(relation: WireRelation, target: TableThunk): RelationDef {
    switch (relation.kind) {
        case "belongsTo": {
            const { kind: _kind, target: _target, ...options } = relation;
            void _kind; void _target;
            return rel.belongsTo(target, options);
        }
        case "hasOne": {
            const { kind: _kind, target: _target, ...options } = relation;
            void _kind; void _target;
            return rel.hasOne(target, options);
        }
        case "hasMany": {
            const { kind: _kind, target: _target, ...options } = relation;
            void _kind; void _target;
            return rel.hasMany(target, options);
        }
        case "manyToMany": {
            const { kind: _kind, target: _target, pivot, ...options } = relation;
            void _kind; void _target;
            const columns = pivot !== undefined ? columnsFromWire(pivot) : undefined;
            return rel.manyToMany(target, { ...options, ...(columns ? { pivot: columns } : {}) });
        }
        case "via": {
            const { kind: _kind, target: _target, ...options } = relation;
            void _kind; void _target;
            return rel.via(target, options);
        }
    }
}

function columnsFromWire(columns: Record<string, WireColumnDef>): ColumnsShape {
    const out: ColumnsShape = {};
    for (const [key, column] of Object.entries(columns)) out[key] = new ColumnBuilder(columnDefFromWire(column));
    return out;
}

const usesJson = (def: ColumnDef): boolean => def.json !== undefined || (def.element !== undefined && usesJson(def.element));

const TEMPORAL_KINDS = new Set(["timestamptz", "date", "time"]);

/** Whether the printed chain uses the `sql` tag: a SQL default other than `.defaultNow()`, or a generated expression. */
const usesSql = (def: ColumnDef): boolean =>
    def.generatedAs !== undefined ||
    (def.default?.kind === "sql" && !(def.default.expression === "now()" && TEMPORAL_KINDS.has(def.type.kind))) ||
    (def.element !== undefined && usesSql(def.element));

/** The builders a printed column needs imported. */
const buildersOf = (def: ColumnDef): ("col" | "json" | "sql")[] =>
    ["col", ...(usesJson(def) ? ["json" as const] : []), ...(usesSql(def) ? ["sql" as const] : [])];

/**
 * How a printed column names an enum type with a stated name: by the file's
 * `pgEnum` binding for it, declared above the table when the file has none.
 * Returns the binder for `printColumn` and the step that writes the
 * declarations it asked for, run after the column is spliced in.
 */
function enumBinder(workspace: Workspace, slug: string): { bind: (enumName: string, values: readonly string[]) => string; declare: () => void } {
    const table = workspace.writable(slug);
    const source = workspace.source(table.file);
    const known = [...enumBindings(source).values()];
    const added: EnumBinding[] = [];
    const bind = (enumName: string, values: readonly string[]): string => {
        const existing = [...known, ...added].find(binding => binding.enumName === enumName);
        if (existing) {
            if (existing.values.join("\u0000") !== values.join("\u0000")) {
                throw refusal(
                    `${path.basename(table.file)} declares the enum type "${enumName}" with the labels ${JSON.stringify(existing.values)}; ` +
                    `the column lists ${JSON.stringify(values)}. Change the \`pgEnum\` declaration in code.`,
                    slug
                );
            }
            return existing.identifier;
        }
        let identifier = enumIdentifier(enumName);
        const taken = (name: string): boolean => source.getVariableDeclaration(name) !== undefined ||
            source.getImportDeclarations().some(each => each.getNamedImports().some(element => (element.getAliasNode()?.getText() ?? element.getName()) === name)) ||
            added.some(binding => binding.identifier === name);
        while (taken(identifier)) identifier = `${identifier}Type`;
        added.push({ identifier, enumName, values: [...values] });
        return identifier;
    };
    const declare = (): void => {
        if (added.length === 0) return;
        const statement = workspace.writable(slug).declaration.getVariableStatement();
        const at = statement ? statement.getStart(true) : 0;
        const lines = added.map(binding => `const ${binding.identifier} = pgEnum(${JSON.stringify(binding.enumName)}, [${binding.values.map(value => JSON.stringify(value)).join(", ")}]);`);
        workspace.edit(table.file, [{ start: at, end: at, text: `${lines.join("\n")}\n\n` }]);
        ensureBuilders(workspace, table.file, ["pgEnum"]);
    };
    return { bind, declare };
}

/** `key: <chain>`, printed by `printColumn`. */
function printedColumn(
    key: string,
    column: WireColumnDef,
    transform: string | undefined,
    enumIdentifierOf: (enumName: string, values: readonly string[]) => string
): { text: string; def: ColumnDef } {
    const def = columnDefFromWire(column);
    return { text: `${printKey(key)}: ${printColumn(def, { key, enumIdentifier: enumIdentifierOf, ...(transform !== undefined ? { transform } : {}) })}`, def };
}

/** The `columns` or `relations` object of a table, writable, or a refusal. */
function mapOf(table: LocatedTable & { config: ObjectLiteralExpression }, key: "columns" | "relations"): ObjectLiteralExpression | undefined {
    const found = member(table.config, key, `table "${table.slug}"`);
    if (found.kind === "absent") return undefined;
    if (found.kind === "code") throw refusal(`Table "${table.slug}" is edited in code there: ${found.reason}`, table.slug, key);
    const object = unwrapExpression(found.value);
    if (!object || !Node.isObjectLiteralExpression(object)) {
        throw refusal(`The \`${key}\` of table "${table.slug}" is edited in code: it is not an object literal.`, table.slug, key);
    }
    const opaque = opaqueMembers(object, `the \`${key}\` of table "${table.slug}"`);
    if (opaque) throw refusal(`Table "${table.slug}" is edited in code there: ${opaque}`, table.slug, key);
    return object;
}

/** One entry of `columns` / `relations`, or a refusal naming what is missing. */
function entryOf(object: ObjectLiteralExpression, key: string, table: string, what: "column" | "relation"): { node: Node; value: Node; index: number } {
    const found = member(object, key, `${what}s`);
    if (found.kind === "written") return found;
    if (found.kind === "code") throw refusal(`The ${what} "${key}" of table "${table}" is edited in code: ${found.reason}`, table, key);
    throw refusal(`Table "${table}" has no ${what} "${key}".`, table, key);
}

/** Insert a `key: value` member into a table's config at its place in the canonical key order. */
function insertConfigMember(workspace: Workspace, table: LocatedTable & { config: ObjectLiteralExpression }, key: string, printed: string): void {
    const order: readonly string[] = TABLE_KEY_ORDER;
    const rank = order.indexOf(key);
    const members = table.config.getProperties();
    let index = members.findIndex(each => {
        const name = memberName(each);
        return name !== undefined && order.indexOf(name) > rank;
    });
    if (index === -1) index = members.length;
    const text = workspace.text(table.file);
    workspace.edit(table.file, insertListItem(text, listShape(table.config, members), index, `${printKey(key)}: ${printed}`, "lines"));
}

function removeMember(workspace: Workspace, file: string, object: ObjectLiteralExpression, index: number): void {
    workspace.edit(file, removeListItem(workspace.text(file), listShape(object, object.getProperties()), index));
}

/** Whether a node is plain data — what an option's value may be overwritten from. */
export function isData(node: Node): boolean {
    const value = unwrapExpression(node);
    if (!value) return false;
    if (Node.isStringLiteral(value) || Node.isNumericLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value) ||
        Node.isTrueLiteral(value) || Node.isFalseLiteral(value) || Node.isNullLiteral(value)) return true;
    if (Node.isPrefixUnaryExpression(value)) return Node.isNumericLiteral(value.getOperand());
    if (Node.isArrayLiteralExpression(value)) return value.getElements().every(isData);
    if (Node.isObjectLiteralExpression(value)) {
        return value.getProperties().every(each => Node.isPropertyAssignment(each) && memberName(each) !== undefined && isData(each.getInitializerOrThrow()));
    }
    return false;
}

async function applyPatch(workspace: Workspace, patch: TablePatch, editor: TableSourceEditor): Promise<void> {
    switch (patch.op) {
        case "createTable":
            return createTable(workspace, patch.table);
        case "adoptTable":
            return adoptTable(workspace, patch.table);
        case "deleteTable":
            return deleteTable(workspace, patch.table, editor);
        case "addColumn": {
            const table = workspace.writable(patch.table);
            const columns = mapOf(table, "columns");
            if (!columns) throw refusal(`Table "${patch.table}" has no \`columns\` object to add to.`, patch.table, patch.key);
            if (member(columns, patch.key, "columns").kind !== "absent") {
                throw refusal(`Table "${patch.table}" already has a column "${patch.key}". Change it instead.`, patch.table, patch.key);
            }
            const members = columns.getProperties();
            const index = patch.before !== undefined ? entryOf(columns, patch.before, patch.table, "column").index : members.length;
            const enums = enumBinder(workspace, patch.table);
            const { text, def } = printedColumn(patch.key, patch.column, undefined, enums.bind);
            workspace.edit(table.file, insertListItem(workspace.text(table.file), listShape(columns, members), index, text, "lines"));
            enums.declare();
            ensureBuilders(workspace, table.file, buildersOf(def));
            return;
        }
        case "changeColumn":
        case "renameColumn": {
            const table = workspace.writable(patch.table);
            const columns = mapOf(table, "columns");
            if (!columns) throw refusal(`Table "${patch.table}" has no column "${patch.key}".`, patch.table, patch.key);
            const entry = entryOf(columns, patch.key, patch.table, "column");
            const code = columnCode(entry.value, patch.key);
            if (code) throw refusal(`The column "${patch.key}" of table "${patch.table}" is edited in code: ${code}`, patch.table, patch.key);
            const transforms = columnTransforms(entry.value);
            if (transforms.nested) {
                throw refusal(
                    `The column "${patch.key}" of table "${patch.table}" has field-level transforms inside its JSON shape or items, ` +
                    "which the editor cannot carry over: edit it in code.",
                    patch.table,
                    patch.key
                );
            }
            const key = patch.op === "renameColumn" ? patch.to : patch.key;
            if (patch.op === "renameColumn" && patch.to !== patch.key && member(columns, patch.to, "columns").kind !== "absent") {
                throw refusal(`Table "${patch.table}" already has a column "${patch.to}".`, patch.table, patch.to);
            }
            const enums = enumBinder(workspace, patch.table);
            const { text, def } = printedColumn(key, patch.column, transforms.own, enums.bind);
            const source = workspace.text(table.file);
            workspace.edit(table.file, [replaceNode(source, entry.node, text)]);
            enums.declare();
            ensureBuilders(workspace, table.file, buildersOf(def));
            return;
        }
        case "removeColumn": {
            const table = workspace.writable(patch.table);
            const columns = mapOf(table, "columns");
            if (!columns) throw refusal(`Table "${patch.table}" has no column "${patch.key}".`, patch.table, patch.key);
            const entry = entryOf(columns, patch.key, patch.table, "column");
            const code = columnCode(entry.value, patch.key);
            if (code) throw refusal(`The column "${patch.key}" of table "${patch.table}" is edited in code: ${code}`, patch.table, patch.key);
            removeMember(workspace, table.file, columns, entry.index);
            return;
        }
        case "moveColumn": {
            const table = workspace.writable(patch.table);
            const columns = mapOf(table, "columns");
            if (!columns) throw refusal(`Table "${patch.table}" has no column "${patch.key}".`, patch.table, patch.key);
            const entry = entryOf(columns, patch.key, patch.table, "column");
            if (patch.before === patch.key) return;
            if (patch.before !== undefined) entryOf(columns, patch.before, patch.table, "column");
            const moved = itemText(workspace.text(table.file), listShape(columns, columns.getProperties()), entry.index);
            removeMember(workspace, table.file, columns, entry.index);
            const again = mapOf(workspace.writable(patch.table), "columns");
            if (!again) return;
            const members = again.getProperties();
            const index = patch.before !== undefined ? entryOf(again, patch.before, patch.table, "column").index : members.length;
            workspace.edit(table.file, insertListItem(workspace.text(table.file), listShape(again, members), index, moved, "lines"));
            return;
        }
        case "addRelation":
        case "changeRelation":
            return writeRelation(workspace, patch.table, patch.name, patch.relation, patch.op === "changeRelation");
        case "removeRelation": {
            const table = workspace.writable(patch.table);
            const relations = mapOf(table, "relations");
            if (!relations) throw refusal(`Table "${patch.table}" has no relation "${patch.name}".`, patch.table, patch.name);
            const entry = entryOf(relations, patch.name, patch.table, "relation");
            if (!isChainOf(entry.value, "rel")) {
                throw refusal(`The relation "${patch.name}" of table "${patch.table}" is edited in code: it is not a \`rel.*\` call.`, patch.table, patch.name);
            }
            const previous = thunkTarget(entry.value);
            removeMember(workspace, table.file, relations, entry.index);
            if (previous) dropUnusedImport(workspace, table.file, previous);
            return;
        }
        case "setRls": {
            const table = workspace.writable(patch.table);
            if (table.builder === "defineView") throw refusal(`"${patch.table}" is a view: it has no \`rls\` of its own.`, patch.table, "rls");
            const found = member(table.config, "rls", `table "${patch.table}"`);
            const printed = printRls(patch.rls);
            if (found.kind === "absent") {
                insertConfigMember(workspace, table, "rls", printed);
                return;
            }
            if (found.kind === "code") throw refusal(`The \`rls\` of table "${patch.table}" is edited in code: ${found.reason}`, patch.table, "rls");
            const source = workspace.text(table.file);
            workspace.edit(table.file, [replaceNode(source, found.value, printed)]);
            return;
        }
        case "addRule":
        case "replaceRule":
        case "removeRule":
            return writeRule(workspace, patch);
        case "setOption": {
            const table = workspace.writable(patch.table);
            const found = member(table.config, patch.option, `table "${patch.table}"`);
            if (found.kind === "code") throw refusal(`\`${patch.option}\` of table "${patch.table}" is edited in code: ${found.reason}`, patch.table, patch.option);
            if (found.kind === "written" && !isData(found.value)) {
                throw refusal(
                    `\`${patch.option}\` of table "${patch.table}" is edited in code: it is \`${found.value.getText().slice(0, 40)}\`, not a literal.`,
                    patch.table,
                    patch.option
                );
            }
            if (patch.value === null) {
                if (found.kind === "written") removeMember(workspace, table.file, table.config, found.index);
                return;
            }
            const printed = printSchemaValue(patch.value, `${patch.table}.${patch.option}`);
            if (found.kind === "absent") insertConfigMember(workspace, table, patch.option, printed);
            else workspace.edit(table.file, [replaceNode(workspace.text(table.file), found.value, printed)]);
            return;
        }
    }
}

function writeRelation(workspace: Workspace, slug: string, name: string, relation: WireRelation, change: boolean): void {
    const target = workspace.tables().find(table => table.slug === relation.target);
    if (!target) throw refusal(`The relation "${name}" of table "${slug}" targets "${relation.target}", which is not a table in backend/schema.`, slug, name);
    let table = workspace.writable(slug);
    const identifier = bindingFor(workspace, table.file, target);
    table = workspace.writable(slug);
    const def = relationFromWire(relation, () => targetStandIn(target.name, target.slug));
    const printed = printRelation(name, def, { resolveTarget: () => ({ identifier }) });
    const relations = mapOf(table, "relations");
    if (!relations) {
        if (change) throw refusal(`Table "${slug}" has no relation "${name}".`, slug, name);
        insertConfigMember(workspace, table, "relations", `{\n${deeper("")}${printKey(name)}: ${reindent(printed, deeper(""))}\n}`);
    } else if (change) {
        const entry = entryOf(relations, name, slug, "relation");
        if (!isChainOf(entry.value, "rel")) {
            throw refusal(`The relation "${name}" of table "${slug}" is edited in code: it is not a \`rel.*\` call.`, slug, name);
        }
        const previous = thunkTarget(entry.value);
        workspace.edit(table.file, [replaceNode(workspace.text(table.file), entry.node, `${printKey(name)}: ${printed}`)]);
        if (previous && previous !== identifier) dropUnusedImport(workspace, table.file, previous);
    } else {
        if (member(relations, name, "relations").kind !== "absent") {
            throw refusal(`Table "${slug}" already has a relation "${name}". Change it instead.`, slug, name);
        }
        const members = relations.getProperties();
        workspace.edit(table.file, insertListItem(workspace.text(table.file), listShape(relations, members), members.length, `${printKey(name)}: ${printed}`, "lines"));
    }
    const pivot = relation.kind === "manyToMany" && relation.pivot !== undefined ? Object.values(relation.pivot).map(columnDefFromWire) : [];
    ensureBuilders(workspace, table.file, pivot.length > 0 ? (pivot.some(usesJson) ? ["rel", "col", "json"] : ["rel", "col"]) : ["rel"]);
}

/** The `rls` rule list of a table, writable, or a refusal. */
function rulesOf(table: LocatedTable & { config: ObjectLiteralExpression }): ArrayLiteralExpression {
    const found = member(table.config, "rls", `table "${table.slug}"`);
    if (found.kind === "code") throw refusal(`The \`rls\` of table "${table.slug}" is edited in code: ${found.reason}`, table.slug, "rls");
    const value = found.kind === "written" ? unwrapExpression(found.value) : undefined;
    if (!value || !Node.isArrayLiteralExpression(value)) {
        throw refusal(
            `The \`rls\` of table "${table.slug}" is ${value ? `\`${value.getText().slice(0, 40)}\`` : "absent"}, not a list of rules. ` +
            "Set the rules with `setRls` first.",
            table.slug,
            "rls"
        );
    }
    if (value.getElements().some(element => Node.isSpreadElement(element))) {
        throw refusal(`The \`rls\` of table "${table.slug}" is edited in code: it spreads another list of rules.`, table.slug, "rls");
    }
    return value;
}

function writeRule(workspace: Workspace, patch: Extract<TablePatch, { op: "addRule" | "replaceRule" | "removeRule" }>): void {
    const table = workspace.writable(patch.table);
    const rules = rulesOf(table);
    const elements = rules.getElements();
    const list = listShape(rules, elements);
    const source = workspace.text(table.file);
    const index = patch.index ?? elements.length;
    if (patch.op === "addRule") {
        if (index > elements.length) throw refusal(`Table "${patch.table}" has ${elements.length} rule(s); there is no position ${index}.`, patch.table, "rls");
        const printed = printSchemaValue(patch.rule, `${patch.table}.rls[${index}]`);
        workspace.edit(table.file, insertListItem(source, list, index, printed, "lines"));
        return;
    }
    if (index >= elements.length) throw refusal(`Table "${patch.table}" has ${elements.length} rule(s); there is no rule ${index}.`, patch.table, "rls");
    const element = elements[index];
    if (!Node.isObjectLiteralExpression(unwrapExpression(element) ?? element)) {
        throw refusal(`Rule ${index} of table "${patch.table}" is edited in code: it is \`${element.getText().slice(0, 40)}\`.`, patch.table, "rls");
    }
    if (patch.op === "removeRule") {
        if (elements.length === 1) {
            throw refusal(`Rule ${index} is the last rule of table "${patch.table}", and an empty list leaves nobody a policy. Set \`rls\` to "admin-only" instead.`, patch.table, "rls");
        }
        workspace.edit(table.file, removeListItem(source, list, index));
        return;
    }
    workspace.edit(table.file, [replaceNode(source, element, printSchemaValue(patch.rule, `${patch.table}.rls[${index}]`))]);
}

/** The builders' module specifier this project writes: whatever an existing table file imports them from. */
function builderSpecifier(workspace: Workspace): string {
    for (const table of workspace.tables()) {
        const found = builderImport(workspace.source(table.file));
        if (found) return found.declaration.getModuleSpecifierValue();
    }
    return DEFAULT_SCHEMA_SPECIFIER;
}

function createTable(workspace: Workspace, spec: NewTable): void {
    const tables = workspace.tables();
    const slug = spec.slug ?? spec.name;
    const clash = tables.find(table => table.slug === slug || table.name === spec.name);
    if (clash) throw refusal(`There is already a table "${clash.name}" (slug "${clash.slug}") in backend/schema.`, spec.name);
    const file = path.join(workspace.dir, `${spec.name}.ts`);
    if (workspace.has(file) || fs.existsSync(file)) throw refusal(`${file} already exists.`, spec.name);
    const identifier = tableIdentifier(spec.name);
    if (tables.some(table => table.exportName === identifier)) {
        throw refusal(`The schema index already exports \`${identifier}\`, the name the new table would be exported as.`, spec.name);
    }

    // The new table, for a relation of its own: its thunk is read when printed.
    const self: { def?: AnyTableDef } = {};
    const relations: RelationsShape = {};
    for (const [name, relation] of Object.entries(spec.relations ?? {})) {
        if (relation.target === slug) {
            relations[name] = relationFromWire(relation, () => self.def);
            continue;
        }
        const target = tables.find(table => table.slug === relation.target);
        if (!target) throw refusal(`The relation "${name}" targets "${relation.target}", which is not a table in backend/schema.`, spec.name, name);
        relations[name] = relationFromWire(relation, () => targetStandIn(target.name, target.slug));
    }
    const { name: _name, slug: _slug, table: _table, schema: _schema, columns: _columns, relations: _relations, rls: _rls, ...options } = spec;
    void _name; void _slug; void _table; void _schema; void _columns; void _relations; void _rls;
    const created = defineTable(spec.name, {
        ...(spec.slug !== undefined ? { slug: spec.slug } : {}),
        ...(spec.table !== undefined ? { table: spec.table } : {}),
        ...(spec.schema !== undefined ? { schema: spec.schema } : {}),
        ...options,
        columns: columnsFromWire(spec.columns),
        ...(Object.keys(relations).length > 0 ? { relations } : {}),
        rls: spec.rls
    });
    self.def = created;
    const module = printTableModule(created, {
        identifier,
        specifier: builderSpecifier(workspace),
        resolveTarget: target => {
            const found = tables.find(table => table.slug === target.slug);
            if (!found) return { identifier: tableIdentifier(target.name ?? target.slug) };
            return { identifier: found.variable, importPath: relativeSpecifier(file, found.file) };
        }
    });
    workspace.set(file, module);
    exportFromIndex(workspace, identifier, file);
}

/**
 * Write a table the database already has from its description, through the
 * printer — every column type, default, key, foreign key and enum as
 * introspection read it, so planning it changes nothing — and export it.
 */
function adoptTable(workspace: Workspace, descriptor: TableDescriptor): void {
    const tables = workspace.tables();
    const clash = tables.find(table => table.slug === descriptor.slug || table.name === descriptor.name);
    if (clash) throw refusal(`There is already a table "${clash.name}" (slug "${clash.slug}") in backend/schema.`, descriptor.slug);
    const file = path.join(workspace.dir, `${descriptor.name}.ts`);
    if (workspace.has(file) || fs.existsSync(file)) throw refusal(`${file} already exists.`, descriptor.slug);
    const identifier = tableIdentifier(descriptor.name);
    if (tables.some(table => table.exportName === identifier)) {
        throw refusal(`The schema index already exports \`${identifier}\`, the name the adopted table would be exported as.`, descriptor.slug);
    }
    for (const relation of descriptor.relations) {
        if (relation.target === descriptor.slug || tables.some(table => table.slug === relation.target)) continue;
        throw refusal(`The relation "${relation.name}" targets "${relation.target}", which is not a table in backend/schema.`, descriptor.slug, relation.name);
    }
    const module = printTableModule(descriptor, {
        identifier,
        specifier: builderSpecifier(workspace),
        resolveTarget: target => {
            const found = tables.find(table => table.slug === target.slug);
            if (!found) return { identifier };
            return { identifier: found.variable, importPath: relativeSpecifier(file, found.file) };
        }
    });
    workspace.set(file, module);
    exportFromIndex(workspace, identifier, file);
}

/** Export a table's file from the schema index, after the last export (creating the index when there is none). */
function exportFromIndex(workspace: Workspace, identifier: string, file: string): void {
    const line = printIndexModule([{ identifier, importPath: relativeSpecifier(path.join(workspace.dir, "index.ts"), file) }]);
    const indexPath = workspace.indexFile();
    if (!indexPath) {
        workspace.set(path.join(workspace.dir, "index.ts"), line);
        return;
    }
    const index = workspace.source(indexPath);
    const exports = index.getExportDeclarations();
    const text = workspace.text(indexPath);
    if (exports.length > 0) {
        const at = exports[exports.length - 1].getEnd();
        workspace.edit(indexPath, [{ start: at, end: at, text: `\n${line.trimEnd()}` }]);
    } else {
        workspace.edit(indexPath, [{ start: text.length, end: text.length, text: `${text.endsWith("\n") || text === "" ? "" : "\n"}${line}` }]);
    }
}

async function deleteTable(workspace: Workspace, slug: string, editor: TableSourceEditor): Promise<void> {
    const table = workspace.table(slug);
    // Who points at it, read from what the schema compiles to now: a relation's
    // target is a thunk, and only compiling resolves it to a table.
    const current = await editor.compile(workspace.texts());
    const referencing = current.descriptors.flatMap(descriptor =>
        descriptor.slug === slug ? [] : descriptor.relations
            .filter(relation => relation.target === slug)
            .map(relation => `${descriptor.slug}.${relation.name}`));
    if (referencing.length > 0) {
        throw refusal(
            `Table "${slug}" cannot be deleted while relations target it: ${referencing.join(", ")}. ` +
            "Remove or retarget those relations first.",
            slug
        );
    }

    const source = workspace.source(table.file);
    const statement = table.declaration.getFirstAncestor(Node.isVariableStatement);
    if (!statement) throw refusal(`The definition of "${slug}" is not a top-level \`const\`.`, slug);
    const others = source.getStatements().filter(each => each !== statement && !Node.isImportDeclaration(each));
    const indexPath = workspace.indexFile();
    const definedInIndex = table.file === indexPath;
    if (others.length === 0 && !definedInIndex) {
        workspace.delete(table.file);
    } else {
        removeVariable(workspace, table.file, statement, table.declaration);
    }

    if (!indexPath || definedInIndex) return;
    const index = workspace.source(indexPath);
    const deletedFile = !workspace.has(table.file);
    for (const declaration of index.getExportDeclarations()) {
        const targetFile = declaration.getModuleSpecifierSourceFile()?.getFilePath();
        const named = declaration.getNamedExports();
        const position = index.getStatements().indexOf(declaration);
        const previousEnd = position > 0 ? index.getStatements()[position - 1].getEnd() : 0;
        if (named.length === 0) {
            if (deletedFile && targetFile === table.file) workspace.edit(indexPath, [removeStatement(index.getFullText(), declaration, previousEnd)]);
            continue;
        }
        const at = named.findIndex(element => (element.getAliasNode()?.getText() ?? element.getName()) === table.exportName);
        if (at === -1) continue;
        if (named.length === 1) {
            workspace.edit(indexPath, [removeStatement(index.getFullText(), declaration, previousEnd)]);
        } else {
            const element = named[at];
            workspace.edit(indexPath, [at < named.length - 1
                ? { start: element.getStart(), end: named[at + 1].getStart(), text: "" }
                : { start: named[at - 1].getEnd(), end: element.getEnd(), text: "" }]);
        }
        return;
    }
}

function removeVariable(workspace: Workspace, file: string, statement: VariableStatement, declaration: VariableDeclaration): void {
    const source = workspace.source(file);
    const declarations = statement.getDeclarations();
    if (declarations.length > 1) {
        throw refusal(`${file} declares "${declaration.getName()}" together with other constants in one statement: delete it in code.`, declaration.getName());
    }
    const statements = source.getStatements();
    const position = statements.indexOf(statement);
    workspace.edit(file, [removeStatement(source.getFullText(), statement, position > 0 ? statements[position - 1].getEnd() : 0)]);
}
