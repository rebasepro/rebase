import type {
    AnyTableDef,
    AnyViewDef,
    ColumnDef,
    ColumnDescriptor,
    DefaultRls,
    RelationDef,
    RelationDescriptor,
    RlsDescriptor,
    RlsPosture,
    TableDescriptor,
    TableIndex
} from "@rebasepro/types";
import { isColumnBuilder, isTableDef, isViewDef, resourceKeyOf } from "@rebasepro/types";

import { getTableVarName } from "../util/relations";
import {
    deriveBelongsToLocalKey,
    deriveJunctionSourceKey,
    deriveJunctionTable,
    deriveJunctionTargetKey,
    deriveTargetForeignKey
} from "./derive-names";
import { columnChain, joinTransformPath, nestedTransforms } from "./print-column";
import type { ColumnPrintContext, SchemaBuilderName } from "./print-column";
import { array, call, object, printMultilineString, printString, render, text } from "./print-doc";
import type { Doc } from "./print-doc";
import { TablePrintError, valueDoc } from "./print-value";

export { TablePrintError } from "./print-value";
export {
    COLUMN_MODIFIER_ORDER,
    joinTransformPath,
    printByteSize,
    printColumn,
    printJsonShape
} from "./print-column";
export type { PrintColumnOptions, SchemaBuilderName } from "./print-column";

/**
 * Turning a table back into `defineTable` source.
 *
 * One printer for every writer of `backend/schema/*.ts`: the migration codemod
 * (legacy collections → tables), database introspection (descriptors → tables)
 * and the Studio schema editor (one column or relation at a time). They bring
 * their own AST handling and call this for the text, so a column prints the
 * same whoever writes it.
 *
 * Deterministic: the same input is the same bytes — no dates, no environment.
 * Lossless or loud: a value that is code (a hook, a transform) is printed from
 * the source text the caller supplies, and refused with a
 * {@link TablePrintError} when none was supplied.
 */

/** The import specifier the builders come from unless the caller names another. */
export const DEFAULT_SCHEMA_SPECIFIER = "@rebasepro/server/schema";

/**
 * The table-level key order of a printed `defineTable` / `defineAuthTable`.
 * `auth` (from `defineAuthTable`) comes last.
 *
 * @group Schema
 */
export const TABLE_KEY_ORDER = [
    "slug", "table", "schema", "database", "description", "columns", "relations", "rls", "defaultPolicies",
    "tenant", "softDelete", "history", "search", "indexes", "hooks", "strictWrites", "metadata", "auth"
] as const;

/**
 * The key order of a printed `defineView`.
 *
 * @group Schema
 */
export const VIEW_KEY_ORDER = [
    "slug", "schema", "database", "description", "query", "materialized", "roles", "columns", "relations",
    "indexes", "hooks", "metadata"
] as const;

/** The seven table hooks, in the order a descriptor's flags print. */
const HOOK_ORDER = ["beforeQuery", "afterRead", "beforeSave", "afterSave", "afterSaveError", "beforeDelete", "afterDelete"] as const;

/**
 * The name of a table hook.
 *
 * @group Schema
 */
export type TableHookName = typeof HOOK_ORDER[number];

/**
 * How a relation's target is written in the printed module.
 *
 * @group Schema
 */
export interface PrintTarget {
    /** The identifier the target table is bound to: what the thunk returns, `() => users`. */
    identifier: string;
    /** The module to import it from, `"./users"`. No import when absent (the same module). */
    importPath?: string;
    /**
     * The target's SQL table, when known. Lets a descriptor's junction table
     * be left out when it is the derived one; without it `through` is printed.
     */
    table?: string;
    /** Whether the target is a view. A view never gets a `FOREIGN KEY`, so `constraint: false` is not printed for it. */
    kind?: "table" | "view";
    /**
     * The target's module imports this one back (directly or through others),
     * so the thunk needs a return type: TypeScript cannot infer two tables'
     * types from each other (TS7022). Only a descriptor's target needs saying —
     * a definition's cycles are found by following its thunks.
     */
    cyclic?: boolean;
}

/**
 * Maps a relation's target to the identifier and module it is printed with.
 * A definition's target is known by name and slug; a descriptor's by slug.
 *
 * @group Schema
 */
export type PrintTargetResolver = (target: { name?: string; slug: string }) => PrintTarget;

/**
 * Source text for what is code rather than data, printed verbatim.
 *
 * @group Schema
 */
export interface TableSources {
    /**
     * Field-level transforms by path: `"title"` the column, `"tags[]"` an array
     * column's element, `"seo.title"` a field of a JSON column,
     * `"content[].image"` inside a JSON array, `"tags.pivot.note"` a pivot
     * column of the relation `tags`.
     */
    transforms?: Readonly<Record<string, string>>;
    /**
     * The table hooks: the whole `hooks` expression as one string, or each
     * hook's source by name.
     */
    hooks?: string | Readonly<Partial<Record<TableHookName, string>>>;
    /** The user-lifecycle functions of `defineAuthTable`'s `auth`. */
    auth?: { onCreateUser?: string; onResetPassword?: string };
}

/**
 * Options of {@link printTableSource} and {@link printTableModule}.
 *
 * @group Schema
 */
export interface PrintTableOptions {
    /** The identifier of `export const <identifier>`. The camelCase of the table's name when omitted. */
    identifier?: string;
    /** Where the builders are imported from. {@link DEFAULT_SCHEMA_SPECIFIER} when omitted. */
    specifier?: string;
    /** How relation targets are written. `./<name>` exporting the camelCase of the name when omitted. */
    resolveTarget?: PrintTargetResolver;
    /** Source text of the hooks and transforms. */
    sources?: TableSources;
    /** Extra import lines, printed verbatim after the generated ones (what hook sources reference). */
    extraImports?: readonly string[];
    /**
     * When a relation thunk is annotated `(): RelationTarget => users`:
     * `"cycles"` (the default) when the target leads back to this table —
     * TypeScript cannot infer two definitions' types from each other —,
     * `"always"`, or `"never"`.
     */
    annotateTargets?: "cycles" | "always" | "never";
}

/**
 * One table identifier imported for a relation thunk.
 *
 * @group Schema
 */
export interface PrintedTableImport {
    /** The bound name. */
    identifier: string;
    /** The module it comes from. */
    importPath: string;
}

/**
 * What a printed table needs imported.
 *
 * @group Schema
 */
export interface PrintedImports {
    /** The builders' module. */
    specifier: string;
    /** The builders used, in import order (`define*`, `col`, `rel`, `json`). */
    builders: SchemaBuilderName[];
    /** Types imported from the builders' module (`RelationTarget`, for an annotated thunk). */
    types: string[];
    /** The related tables, in the order their relations are declared, each once. */
    tables: PrintedTableImport[];
}

/**
 * A printed table: the `export const` statement and what it needs imported.
 *
 * @group Schema
 */
export interface PrintedTable {
    /** The exported identifier. */
    identifier: string;
    /** `export const <identifier> = defineTable("<name>", { … });` */
    code: string;
    /** What the statement needs imported. */
    imports: PrintedImports;
}

/**
 * What {@link printRelation} needs besides the relation.
 *
 * @group Schema
 */
export interface PrintRelationContext {
    /** How the target is written. `./<name>` exporting the camelCase of the name when omitted. */
    resolveTarget?: PrintTargetResolver;
    /** For a descriptor: the table that declares the relation, to leave derived names out. */
    owner?: TableDescriptor;
    /** Transform sources of pivot columns, by `<relation>.pivot.<column>` path. */
    transforms?: Readonly<Record<string, string>>;
}

/** Anything the module printer takes. */
export type PrintableTable = AnyTableDef | AnyViewDef | TableDescriptor;

const BUILDER_ORDER: readonly SchemaBuilderName[] = ["defineTable", "defineAuthTable", "defineView", "col", "rel", "json"];

const RESERVED = new Set([
    "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "enum",
    "export", "extends", "false", "finally", "for", "function", "if", "import", "in", "instanceof", "new", "null",
    "return", "super", "switch", "this", "throw", "true", "try", "typeof", "var", "void", "while", "with", "yield",
    "let", "static", "implements", "interface", "package", "private", "protected", "public", "await", "arguments",
    "eval", "undefined", "NaN", "Infinity",
    // The builders a printed module imports: a table bound to one would shadow it.
    ...BUILDER_ORDER
]);

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * The identifier a table is exported as: the camelCase of its name, made a
 * valid identifier (a leading digit is prefixed), with `Table` appended when
 * it is a reserved word or the name of a builder the module imports.
 *
 * @group Schema
 */
export function tableIdentifier(name: string): string {
    const identifier = getTableVarName(name);
    return RESERVED.has(identifier) ? `${identifier}Table` : identifier;
}

function checkIdentifier(identifier: string, what: string): string {
    if (!IDENTIFIER.test(identifier) || RESERVED.has(identifier)) {
        throw new TablePrintError(what, `"${identifier}" is not a usable identifier: it must be a JavaScript identifier, not a reserved word or a builder's name.`);
    }
    return identifier;
}

const defaultResolver: PrintTargetResolver = target => {
    const name = target.name ?? target.slug;
    return { identifier: tableIdentifier(name), importPath: `./${name}` };
};

/** Everything printing one table collects and consults. */
interface TableState {
    label: string;
    identifier: string;
    used: Set<SchemaBuilderName>;
    imports: PrintedTableImport[];
    transforms: Readonly<Record<string, string>>;
    resolve: PrintTargetResolver;
    /** Whether a relation target is the table being printed. */
    isSelf: (target: { def?: unknown; slug: string }) => boolean;
    /** When a thunk is annotated. */
    annotate: "cycles" | "always" | "never";
    /** The definition being printed, to find the cycles its thunks close. */
    self?: unknown;
    /** Types the printed source uses. */
    types: Set<string>;
}

/** Whether following relation thunks from `start` reaches `self`. */
function leadsBack(start: unknown, self: unknown): boolean {
    const seen = new Set<unknown>();
    const stack: unknown[] = [start];
    while (stack.length > 0) {
        const current = stack.pop();
        if (current === self) return true;
        if (seen.has(current) || (!isTableDef(current) && !isViewDef(current))) continue;
        seen.add(current);
        for (const relation of Object.values(current.config.relations ?? {})) {
            try {
                stack.push(relation.target());
            } catch {
                // A thunk that cannot resolve yet closes no cycle we can see.
            }
        }
    }
    return false;
}

function columnContext(state: TableState, path: string, prefix: string): ColumnPrintContext {
    return {
        path,
        transforms: nestedTransforms(state.transforms, prefix),
        used: state.used,
        origin: "",
        sourceHint: relative => `as \`sources.transforms["${relative === "" ? prefix : joinTransformPath(prefix, relative)}"]\``
    };
}

/** A `columns` map (or a pivot) as a doc, one column per line. */
function columnsDoc(columns: readonly { key: string; def: ColumnDef; declaresTransform: boolean }[], state: TableState, pathPrefix: string, transformPrefix: string): Doc {
    return object(
        columns.map(({ key, def, declaresTransform }): [string, Doc] => [
            key,
            columnChain(def, columnContext(state, `${pathPrefix}.${key}`, joinTransformPath(transformPrefix, key)), key, declaresTransform)
        ]),
        true
    );
}

function columnsOfDef(columns: object, path: string): { key: string; def: ColumnDef; declaresTransform: boolean }[] {
    return Object.entries(columns).map(([key, builder]: [string, unknown]) => {
        if (!isColumnBuilder(builder)) throw new TablePrintError(`${path}.${key}`, "it is not a `col.*` builder.");
        return { key, def: builder.def, declaresTransform: false };
    });
}

/** A descriptor column, as the definition that compiles to it. */
function columnDefOfDescriptor(column: ColumnDescriptor): ColumnDef {
    const def: ColumnDef = {
        type: column.type,
        column: column.column,
        notNull: !column.nullable,
        primaryKey: column.primaryKey === true,
        unique: column.unique === true,
        readOnly: column.readOnly === true,
        private: column.private === true
    };
    if (column.default !== undefined) def.default = column.default;
    if (column.generated !== undefined) def.generatedAs = column.generated.expression;
    if (column.access !== undefined) def.access = column.access;
    if (column.stamp !== undefined) def.stamp = column.stamp;
    if (column.validate !== undefined) def.validate = column.validate;
    if (column.oneOf !== undefined) def.oneOf = column.oneOf;
    if (column.description !== undefined) def.description = column.description;
    if (column.storage !== undefined) def.storage = column.storage;
    if (column.semantic !== undefined) def.semantic = column.semantic;
    if (column.vectorIndex !== undefined) def.vectorIndex = column.vectorIndex;
    if (column.json !== undefined) def.json = column.json;
    if (column.type.kind === "array") {
        const element: ColumnDef = {
            type: column.type.of,
            notNull: false,
            primaryKey: false,
            unique: false,
            readOnly: false,
            private: false
        };
        if (column.element?.validate !== undefined) element.validate = column.element.validate;
        if (column.element?.oneOf !== undefined) element.oneOf = column.element.oneOf;
        if (column.element?.storage !== undefined) element.storage = column.element.storage;
        def.element = element;
    }
    return def;
}

function columnsOfDescriptor(columns: readonly ColumnDescriptor[]): { key: string; def: ColumnDef; declaresTransform: boolean }[] {
    return columns
        .filter(column => column.derived !== true)
        .map(column => ({ key: column.key, def: columnDefOfDescriptor(column), declaresTransform: column.transforms !== undefined }));
}

// ── Relations ────────────────────────────────────────────────────────────────

const RELATION_KEYS: Readonly<Record<RelationDef["kind"], readonly string[]>> = {
    belongsTo: ["localKey", "notNull", "unique", "onDelete", "onUpdate", "index", "constraint"],
    hasOne: ["foreignKey", "sourceKey"],
    hasMany: ["foreignKey", "sourceKey", "orderBy"],
    manyToMany: ["through", "sourceKey", "targetKey", "pivot", "onDelete"],
    via: ["steps", "cardinality"]
};

/** The thunk `() => <identifier>`, recording the import it needs. */
function targetThunk(state: TableState, target: { name?: string; slug: string; def?: unknown }, path: string): { doc: Doc; printed: PrintTarget } {
    const self = state.isSelf(target);
    const printed: PrintTarget = self ? { identifier: state.identifier } : state.resolve({ name: target.name, slug: target.slug });
    if (!self) {
        checkIdentifier(printed.identifier, `${path} (target identifier)`);
        if (printed.importPath !== undefined && !state.imports.some(entry => entry.identifier === printed.identifier && entry.importPath === printed.importPath)) {
            state.imports.push({ identifier: printed.identifier, importPath: printed.importPath });
        }
    }
    const cyclic = self || printed.cyclic === true || (target.def !== undefined && state.self !== undefined && leadsBack(target.def, state.self));
    const annotate = state.annotate === "always" || (state.annotate === "cycles" && cyclic);
    if (annotate) state.types.add("RelationTarget");
    return { doc: text(`${annotate ? "(): RelationTarget" : "()"} => ${printed.identifier}`), printed };
}

function relationOfDef(name: string, relation: RelationDef, state: TableState): Doc {
    const path = `${state.label}.relations.${name}`;
    state.used.add("rel");
    let target: unknown;
    try {
        target = relation.target();
    } catch (error) {
        throw new TablePrintError(path, `its target thunk threw: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!isTableDef(target) && !isViewDef(target)) {
        throw new TablePrintError(path, "its target thunk does not return a `defineTable` / `defineView` result.");
    }
    const { doc: thunk } = targetThunk(state, { name: target.name, slug: target.config.slug ?? target.name, def: target }, path);
    const known = RELATION_KEYS[relation.kind];
    for (const key of Object.keys(relation)) {
        if (key === "brand" || key === "kind" || key === "target") continue;
        if (!known.includes(key)) throw new TablePrintError(`${path}.${key}`, `it is not an option of \`rel.${relation.kind}\`.`);
    }
    const entries: [string, Doc][] = [];
    for (const key of known) {
        const value: unknown = Reflect.get(relation, key);
        if (value === undefined) continue;
        if (key === "pivot" && typeof value === "object" && value !== null) {
            const pivot = columnsOfDef(value, `${path}.pivot`);
            entries.push([key, columnsDoc(pivot, state, `${path}.pivot`, `${name}.pivot`)]);
        } else {
            entries.push([key, valueDoc(value, `${path}.${key}`)]);
        }
    }
    return call(`rel.${relation.kind}`, entries.length > 0 || relation.kind === "via" ? [thunk, object(entries)] : [thunk]);
}

function relationOfDescriptor(relation: RelationDescriptor, owner: TableDescriptor, state: TableState): Doc {
    const path = `${state.label}.relations.${relation.name}`;
    state.used.add("rel");
    const { doc: thunk, printed } = targetThunk(state, { slug: relation.target }, path);
    const entries: [string, Doc][] = [];
    const str = (value: string): Doc => text(printString(value));
    switch (relation.kind) {
        case "belongsTo": {
            if (relation.localKey !== deriveBelongsToLocalKey(relation.name, undefined)) entries.push(["localKey", str(relation.localKey)]);
            const derived = owner.columns.find(column => column.key === relation.localField && column.derived === true);
            if (derived && !derived.nullable && !(owner.tenant?.field === derived.key)) entries.push(["notNull", text("true")]);
            if (derived?.unique) entries.push(["unique", text("true")]);
            if (relation.onDelete !== undefined) entries.push(["onDelete", str(relation.onDelete)]);
            if (relation.onUpdate !== undefined) entries.push(["onUpdate", str(relation.onUpdate)]);
            if (!relation.index) entries.push(["index", text("false")]);
            const targetIsView = printed.kind === "view" || (state.isSelf({ slug: relation.target }) && owner.kind === "view");
            if (!relation.constraint && owner.kind === "table" && !targetIsView) entries.push(["constraint", text("false")]);
            break;
        }
        case "hasOne":
        case "hasMany":
            if (relation.foreignKey !== deriveTargetForeignKey(owner.slug, undefined)) entries.push(["foreignKey", str(relation.foreignKey)]);
            if (relation.sourceKey !== undefined) entries.push(["sourceKey", str(relation.sourceKey)]);
            if (relation.kind === "hasMany" && relation.orderBy !== undefined) entries.push(["orderBy", valueDoc(relation.orderBy, `${path}.orderBy`)]);
            break;
        case "manyToMany": {
            const targetTable = state.isSelf({ slug: relation.target }) ? owner.table : printed.table;
            if (targetTable === undefined || relation.through.table !== deriveJunctionTable(owner.table, targetTable, undefined)) {
                entries.push(["through", str(relation.through.table)]);
            }
            if (relation.through.sourceKey !== deriveJunctionSourceKey(owner.slug, undefined)) entries.push(["sourceKey", str(relation.through.sourceKey)]);
            if (relation.through.targetKey !== deriveJunctionTargetKey(relation.name, undefined)) entries.push(["targetKey", str(relation.through.targetKey)]);
            if (relation.through.pivot.length > 0) {
                entries.push(["pivot", columnsDoc(columnsOfDescriptor(relation.through.pivot), state, `${path}.pivot`, `${relation.name}.pivot`)]);
            }
            if (relation.onDelete !== undefined) entries.push(["onDelete", str(relation.onDelete)]);
            break;
        }
        case "via":
            entries.push(["steps", valueDoc(relation.steps, `${path}.steps`)]);
            if (relation.cardinality === "one") entries.push(["cardinality", str("one")]);
            break;
    }
    return call(`rel.${relation.kind}`, entries.length > 0 ? [thunk, object(entries)] : [thunk]);
}

// ── rls, hooks, indexes ──────────────────────────────────────────────────────

/** `rls` as a doc: a posture string, or one rule per line, each rule's keys in the order written. */
function rlsDoc(rls: RlsPosture | DefaultRls | readonly unknown[], path: string): Doc {
    if (typeof rls === "string") return text(printString(rls));
    return array(rls.map((rule, index) => valueDoc(rule, `${path}[${index}]`)), true);
}

function rlsOfDescriptor(rls: RlsDescriptor, path: string): Doc {
    if (rls.inherited) return text(printString("inherit"));
    if (rls.posture === "admin-only") return text(printString("admin-only"));
    if (rls.rules.length === 0) throw new TablePrintError(path, "the descriptor has rule-based rls with no rules, which `defineTable` refuses. Say `\"admin-only\"` or list the rules.");
    return rlsDoc(rls.rules, path);
}

function hooksDoc(hooks: object | undefined, flags: readonly TableHookName[], state: TableState, sources: TableSources["hooks"]): Doc | undefined {
    const path = `${state.label}.hooks`;
    if (typeof sources === "string") return text(sources);
    const names: string[] = hooks !== undefined ? Object.keys(hooks) : [...flags];
    if (hooks === undefined && names.length === 0) return undefined;
    const entries: [string, Doc][] = [];
    for (const name of names) {
        const value: unknown = hooks !== undefined ? Reflect.get(hooks, name) : undefined;
        if (value === undefined && hooks !== undefined) continue;
        if (hooks !== undefined && typeof value !== "function") {
            throw new TablePrintError(`${path}.${name}`, "a hook must be a function.");
        }
        const source = sources !== undefined ? Reflect.get(sources, name) : undefined;
        if (typeof source !== "string") {
            throw new TablePrintError(`${path}.${name}`, `the hook is a function, which cannot be printed from its value. Pass its source text as \`sources.hooks.${name}\`.`);
        }
        entries.push([name, text(source)]);
    }
    return object(entries, true);
}

/**
 * The `rls` of a table as source: `"admin-only"`, `"inherit"`, or the rules,
 * one per line, each rule's keys in the order written (a policy's name is a
 * hash of its rule as written, so a rule is never reordered).
 *
 * @group Schema
 */
export function printRls(rls: RlsPosture | DefaultRls | RlsDescriptor): string {
    if (typeof rls === "object" && "posture" in rls) return render(rlsOfDescriptor(rls, "rls"));
    return render(rlsDoc(rls, "rls"));
}

/**
 * The `indexes` of a table as source.
 *
 * @group Schema
 */
export function printIndexes(indexes: readonly TableIndex[]): string {
    return render(valueDoc(indexes, "indexes"));
}

/**
 * One relation as source: `rel.belongsTo(() => users, { onDelete: "restrict" })`.
 *
 * A definition prints with the options it was written with; a descriptor
 * prints the options that differ from what the compiler derives (give
 * `context.owner`, the declaring table's descriptor).
 *
 * @group Schema
 */
export function printRelation(name: string, relation: RelationDef | RelationDescriptor, context: PrintRelationContext = {}): string {
    const state: TableState = {
        label: context.owner?.name ?? "table",
        identifier: context.owner ? tableIdentifier(context.owner.name) : "table",
        used: new Set(),
        imports: [],
        transforms: context.transforms ?? {},
        resolve: context.resolveTarget ?? defaultResolver,
        isSelf: target => context.owner !== undefined && target.def === undefined && target.slug === context.owner.slug,
        annotate: "never",
        types: new Set()
    };
    if ("brand" in relation) return render(relationOfDef(name, relation, state));
    if (!context.owner) {
        throw new TablePrintError(`relations.${name}`, "a relation descriptor prints against the table that declares it: pass `context.owner`.");
    }
    return render(relationOfDescriptor(relation, context.owner, state));
}

// ── Tables ───────────────────────────────────────────────────────────────────

const TABLE_CONFIG_KEYS = new Set<string>(TABLE_KEY_ORDER);
const VIEW_CONFIG_KEYS = new Set<string>(VIEW_KEY_ORDER);

function checkKnownKeys(config: object, known: ReadonlySet<string>, path: string, builder: string): void {
    for (const key of Object.keys(config)) {
        if (!known.has(key) || key === "auth") {
            if (Reflect.get(config, key) === undefined) continue;
            throw new TablePrintError(`${path}.${key}`, `it is not an option of \`${builder}\`.`);
        }
    }
}

function authDoc(auth: object, state: TableState, sources: TableSources["auth"]): Doc | undefined {
    const entries: [string, Doc][] = [];
    for (const [key, value] of Object.entries(auth)) {
        if (value === undefined) continue;
        if (typeof value === "function") {
            const source = key === "onCreateUser" ? sources?.onCreateUser : key === "onResetPassword" ? sources?.onResetPassword : undefined;
            if (source === undefined) {
                throw new TablePrintError(`${state.label}.auth.${key}`, `it is a function, which cannot be printed from its value. Pass its source text as \`sources.auth.${key}\`.`);
            }
            entries.push([key, text(source)]);
        } else {
            entries.push([key, valueDoc(value, `${state.label}.auth.${key}`)]);
        }
    }
    return entries.length > 0 ? object(entries) : undefined;
}

function newState(name: string, identifier: string, options: PrintTableOptions, isSelf: TableState["isSelf"], self?: unknown): TableState {
    return {
        label: name,
        identifier,
        used: new Set(),
        imports: [],
        transforms: options.sources?.transforms ?? {},
        resolve: options.resolveTarget ?? defaultResolver,
        isSelf,
        annotate: options.annotateTargets ?? "cycles",
        self,
        types: new Set()
    };
}

function definitionDoc(def: AnyTableDef | AnyViewDef, state: TableState, options: PrintTableOptions): Doc {
    const config = def.config;
    const entries: [string, Doc][] = [];
    const put = (key: string, value: unknown): void => {
        if (value !== undefined) entries.push([key, valueDoc(value, `${state.label}.${key}`)]);
    };
    const columns = (): Doc => columnsDoc(columnsOfDef(config.columns, `${state.label}.columns`), state, `${state.label}.columns`, "");
    const relations = (): void => {
        if (config.relations === undefined) return;
        entries.push(["relations", object(
            Object.entries(config.relations).map(([name, relation]): [string, Doc] => [name, relationOfDef(name, relation, state)]),
            true
        )]);
    };
    const hooks = (): void => {
        const doc = hooksDoc(config.hooks, [], state, options.sources?.hooks);
        if (config.hooks !== undefined && doc) entries.push(["hooks", doc]);
    };
    const database = config.database !== undefined ? resourceKeyOf(config.database) : undefined;

    if (isViewDef(def)) {
        state.used.add("defineView");
        checkKnownKeys(def.config, VIEW_CONFIG_KEYS, state.label, "defineView");
        const view = def.config;
        put("slug", view.slug);
        put("schema", view.schema);
        put("database", database);
        put("description", view.description);
        entries.push(["query", text(printMultilineString(view.query))]);
        put("materialized", view.materialized);
        put("roles", view.roles);
        entries.push(["columns", columns()]);
        relations();
        put("indexes", view.indexes);
        hooks();
        put("metadata", view.metadata);
        return call("defineView", [text(printString(def.name)), object(entries, true)]);
    }

    const table = def.config;
    const auth = def.auth !== undefined;
    state.used.add(auth ? "defineAuthTable" : "defineTable");
    checkKnownKeys(table, TABLE_CONFIG_KEYS, state.label, auth ? "defineAuthTable" : "defineTable");
    put("slug", table.slug);
    put("table", table.table);
    put("schema", table.schema);
    put("database", database);
    put("description", table.description);
    entries.push(["columns", columns()]);
    relations();
    entries.push(["rls", rlsDoc(table.rls, `${state.label}.rls`)]);
    put("defaultPolicies", table.defaultPolicies);
    put("tenant", table.tenant);
    put("softDelete", table.softDelete);
    put("history", table.history);
    put("search", table.search);
    put("indexes", table.indexes);
    hooks();
    put("strictWrites", table.strictWrites);
    put("metadata", table.metadata);
    if (def.auth !== undefined) {
        const doc = authDoc(def.auth, state, options.sources?.auth);
        if (doc) entries.push(["auth", doc]);
    }
    return call(auth ? "defineAuthTable" : "defineTable", [text(printString(def.name)), object(entries, true)]);
}

function descriptorDoc(descriptor: TableDescriptor, state: TableState, options: PrintTableOptions): Doc {
    const entries: [string, Doc][] = [];
    const put = (key: string, value: unknown): void => {
        if (value !== undefined) entries.push([key, valueDoc(value, `${state.label}.${key}`)]);
    };
    const view = descriptor.kind === "view";
    put("slug", descriptor.slug !== descriptor.name ? descriptor.slug : undefined);
    if (!view) put("table", descriptor.table !== descriptor.name ? descriptor.table : undefined);
    put("schema", descriptor.schema !== "public" ? descriptor.schema : undefined);
    put("database", descriptor.database);
    put("description", descriptor.description);
    const columns = object(
        columnsOfDescriptor(descriptor.columns).map(({ key, def, declaresTransform }): [string, Doc] =>
            [key, columnChain(def, columnContext(state, `${state.label}.columns.${key}`, key), key, declaresTransform)]),
        true
    );
    const relations = descriptor.relations.length > 0
        ? object(descriptor.relations.map((relation): [string, Doc] => [relation.name, relationOfDescriptor(relation, descriptor, state)]), true)
        : undefined;
    const hookNames = HOOK_ORDER.filter(name => descriptor.hooks?.[name] === true);
    const hooks = hookNames.length > 0 ? hooksDoc(undefined, hookNames, state, options.sources?.hooks) : undefined;

    if (view) {
        state.used.add("defineView");
        if (descriptor.view?.query === undefined) {
            throw new TablePrintError(`${state.label}.query`, "the view's descriptor carries no query (it is served to admins only). Print from a descriptor that includes it.");
        }
        entries.push(["query", text(printMultilineString(descriptor.view.query))]);
        if (descriptor.view.materialized) {
            put("materialized", true);
            const roles = descriptor.view.roles;
            if (roles !== undefined && !(roles.length === 1 && roles[0] === "admin")) put("roles", roles);
        }
        entries.push(["columns", columns]);
        if (relations) entries.push(["relations", relations]);
        put("indexes", descriptor.indexes);
        if (hooks) entries.push(["hooks", hooks]);
        put("metadata", descriptor.metadata);
        return call("defineView", [text(printString(descriptor.name)), object(entries, true)]);
    }

    const auth = descriptor.auth !== undefined;
    state.used.add(auth ? "defineAuthTable" : "defineTable");
    entries.push(["columns", columns]);
    if (relations) entries.push(["relations", relations]);
    entries.push(["rls", rlsOfDescriptor(descriptor.rls, `${state.label}.rls`)]);
    if (!descriptor.rls.defaultPolicies && descriptor.rls.posture === "rules") put("defaultPolicies", false);
    put("tenant", descriptor.tenant);
    put("softDelete", descriptor.softDelete);
    put("history", descriptor.history);
    put("search", descriptor.search);
    put("indexes", descriptor.indexes);
    if (hooks) entries.push(["hooks", hooks]);
    put("strictWrites", descriptor.strictWrites);
    put("metadata", descriptor.metadata);
    if (descriptor.auth !== undefined) {
        const doc = authDoc(descriptor.auth, state, options.sources?.auth);
        if (doc) entries.push(["auth", doc]);
    }
    return call(auth ? "defineAuthTable" : "defineTable", [text(printString(descriptor.name)), object(entries, true)]);
}

/**
 * One table as an `export const` statement, with what it needs imported.
 *
 * Takes an authored definition (`defineTable` / `defineAuthTable` /
 * `defineView`, printed as written) or a compiled {@link TableDescriptor}
 * (introspection's output: derived names and defaults are left out, derived
 * foreign-key columns are left to their relation).
 *
 * Keys in {@link TABLE_KEY_ORDER} / {@link VIEW_KEY_ORDER}, columns in the
 * canonical modifier order, four-space indentation, double quotes, no
 * trailing commas.
 *
 * @group Schema
 */
export function printTableSource(input: PrintableTable, options: PrintTableOptions = {}): PrintedTable {
    const name = input.name;
    const identifier = options.identifier !== undefined
        ? checkIdentifier(options.identifier, `${name} (identifier)`)
        : tableIdentifier(name);
    let state: TableState;
    let doc: Doc;
    if (isTableDef(input) || isViewDef(input)) {
        state = newState(name, identifier, options, target => target.def === input, input);
        doc = definitionDoc(input, state, options);
    } else {
        state = newState(name, identifier, options, target => target.def === undefined && target.slug === input.slug);
        doc = descriptorDoc(input, state, options);
    }
    const code = `export const ${identifier} = ${render(doc, 0, `export const ${identifier} = `.length)};`;
    return {
        identifier,
        code,
        imports: {
            specifier: options.specifier ?? DEFAULT_SCHEMA_SPECIFIER,
            builders: BUILDER_ORDER.filter(builder => state.used.has(builder)),
            types: [...state.types].sort(),
            tables: state.imports
        }
    };
}

/** The import lines of a printed table: builders first, then related tables grouped by module. */
export function printImportLines(imports: PrintedImports): string[] {
    const names = [...imports.builders, ...imports.types.map(type => `type ${type}`)];
    const lines = [`import { ${names.join(", ")} } from ${printString(imports.specifier)};`];
    const byPath = new Map<string, string[]>();
    for (const entry of imports.tables) {
        const list = byPath.get(entry.importPath) ?? [];
        if (!list.includes(entry.identifier)) list.push(entry.identifier);
        byPath.set(entry.importPath, list);
    }
    for (const [importPath, identifiers] of byPath) lines.push(`import { ${identifiers.join(", ")} } from ${printString(importPath)};`);
    return lines;
}

/**
 * One table as a whole module — what `backend/schema/<table>.ts` holds:
 *
 * ```ts
 * import { defineTable, col, rel } from "@rebasepro/server/schema";
 * import { users } from "./users";
 *
 * export const posts = defineTable("posts", { … });
 * ```
 *
 * @group Schema
 */
export function printTableModule(input: PrintableTable, options: PrintTableOptions = {}): string {
    const printed = printTableSource(input, options);
    const imports = [...printImportLines(printed.imports), ...(options.extraImports ?? [])];
    return `${imports.join("\n")}\n\n${printed.code}\n`;
}

/**
 * Options of {@link printIndexModule}.
 *
 * @group Schema
 */
export interface PrintIndexModuleOptions {
    /** The project's `defaultRls`, exported for every `rls: "inherit"` table. */
    defaultRls?: DefaultRls;
}

/**
 * `backend/schema/index.ts`: one re-export per table, in the order given, and
 * `defaultRls` when the project has one.
 *
 * @group Schema
 */
export function printIndexModule(tables: readonly PrintedTableImport[], options: PrintIndexModuleOptions = {}): string {
    const lines = tables.map(table => {
        checkIdentifier(table.identifier, `index (${table.importPath})`);
        return `export { ${table.identifier} } from ${printString(table.importPath)};`;
    });
    if (options.defaultRls !== undefined) {
        const prefix = "export const defaultRls = ";
        lines.push("", `${prefix}${render(rlsDoc(options.defaultRls, "defaultRls"), 0, prefix.length)} as const;`);
    }
    return `${lines.join("\n")}\n`;
}
