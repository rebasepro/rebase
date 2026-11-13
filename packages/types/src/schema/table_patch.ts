import type { SecurityRule } from "../types/security_rules";
import type { SearchConfig } from "../types/search";
import type { ColumnDef } from "./columns";
import type { TableDescriptor } from "./descriptor";
import type { JsonShape } from "./json";
import type { BelongsToOptions, HasManyOptions, HasOptions, ManyToManyOptions, ViaOptions } from "./relations";
import type { RlsPosture, TableIndex, TableTenant } from "./table_options";

/**
 * The edits the Studio's schema editor sends the server, one operation at a
 * time.
 *
 * Every operation names the table it edits by **slug** and carries only
 * wire-safe values: a column as its definition without functions, a relation
 * with its target as a slug, a posture or a rule as data. The server applies
 * the operations to `backend/schema/*.ts` — the `defineTable` call, its
 * `columns`, `relations`, `rls` and table-level keys — and nothing else:
 * presentation (labels, icons, column widths, view modes) is not a server edit.
 *
 * Whatever an operation does not name is left exactly as written: comments,
 * hooks, `.transform()` bodies, the other columns and rules.
 *
 * @group Schema
 */
export type TablePatch =
    | CreateTablePatch
    | AdoptTablePatch
    | DeleteTablePatch
    | AddColumnPatch
    | ChangeColumnPatch
    | RenameColumnPatch
    | RemoveColumnPatch
    | MoveColumnPatch
    | AddRelationPatch
    | ChangeRelationPatch
    | RemoveRelationPatch
    | SetRlsPatch
    | AddRulePatch
    | ReplaceRulePatch
    | RemoveRulePatch
    | SetTableOptionPatch;

/**
 * The operation names of {@link TablePatch}.
 *
 * @group Schema
 */
export type TablePatchOp = TablePatch["op"];

/**
 * A column as the wire carries it: its definition without field-level hooks
 * (`.transform()` is code, and stays where it is written), the flags that are
 * `false` by default optional.
 *
 * @group Schema
 */
export type WireColumnDef = Omit<ColumnDef, "transform" | "element" | "json" | "notNull" | "primaryKey" | "unique" | "readOnly" | "private"> & {
    notNull?: boolean;
    primaryKey?: boolean;
    unique?: boolean;
    readOnly?: boolean;
    private?: boolean;
    /** An array column's item. */
    element?: WireColumnDef;
    /** The shape of a `json`/`jsonb` document, without hooks. */
    json?: JsonShape;
};

/**
 * A relation as the wire carries it: the `rel.*` builder's options, its kind,
 * and its target table by slug. `manyToMany` pivot columns are
 * {@link WireColumnDef}s, in the order they are declared.
 *
 * @group Schema
 */
export type WireRelation =
    | (BelongsToOptions & { kind: "belongsTo"; target: string })
    | (HasOptions & { kind: "hasOne"; target: string })
    | (HasManyOptions & { kind: "hasMany"; target: string })
    | (Omit<ManyToManyOptions, "pivot"> & { kind: "manyToMany"; target: string; pivot?: Record<string, WireColumnDef> })
    | (ViaOptions & { kind: "via"; target: string });

/**
 * The table-level keys an edit may set or remove after creation, with the
 * value each takes. `slug`, `table`, `schema` and the table's name are not
 * here: renaming them moves data, which is a migration, not an edit.
 *
 * @group Schema
 */
export interface TableOptionValues {
    description: string;
    tenant: TableTenant;
    softDelete: boolean | { field?: string };
    history: boolean;
    search: SearchConfig;
    indexes: readonly TableIndex[];
    strictWrites: false;
    defaultPolicies: false;
    metadata: Record<string, unknown>;
}

/**
 * A key of {@link TableOptionValues}.
 *
 * @group Schema
 */
export type TableOptionKey = keyof TableOptionValues;

/** The keys of {@link TableOptionValues}, in the order a table prints them. */
export const TABLE_OPTION_KEYS: readonly TableOptionKey[] = [
    "description", "defaultPolicies", "tenant", "softDelete", "history", "search", "indexes", "strictWrites", "metadata"
];

/**
 * A new table: what its `defineTable(name, { … })` call says. Columns and
 * relations print in the order given.
 *
 * @group Schema
 */
export interface NewTable extends Partial<TableOptionValues> {
    /** The name `defineTable` takes; also the file it is written to (`backend/schema/<name>.ts`). */
    name: string;
    /** The slug, when it is not the name. Fixed from here on: renaming a slug moves data. */
    slug?: string;
    /** The SQL table, when it is not the name. */
    table?: string;
    /** The Postgres schema, when it is not `public`. */
    schema?: string;
    columns: Record<string, WireColumnDef>;
    relations?: Record<string, WireRelation>;
    rls: RlsPosture;
}

/** Create `backend/schema/<name>.ts` holding the table, and export it from the index. @group Schema */
export interface CreateTablePatch {
    op: "createTable";
    table: NewTable;
}

/**
 * Adopt a table the database already has and `backend/schema` does not
 * declare ("Import an existing table"): write `backend/schema/<name>.ts` from
 * the table's description as introspection reads it — what
 * `GET /api/admin/schema-editor/unmapped-tables/:schema/:table` serves —
 * through the one printer, and export it from the index.
 *
 * The description states the table exactly as the database has it (column
 * types, defaults, keys, foreign keys as `belongsTo`, enums, types Rebase does
 * not create as `col.custom()`), so planning the adopted table changes nothing
 * in the database. Edits the person made on top of it follow as their own
 * operations, naming the adopted table by its slug.
 *
 * @group Schema
 */
export interface AdoptTablePatch {
    op: "adoptTable";
    table: TableDescriptor;
}

/**
 * Delete a table's definition (its file, or its statement in a file holding
 * others) and its export from the index. Refused while another table's
 * relation targets it. The SQL table and its rows are not dropped.
 *
 * @group Schema
 */
export interface DeleteTablePatch {
    op: "deleteTable";
    table: string;
}

/** Add a column, before the column named by `before`, or last. @group Schema */
export interface AddColumnPatch {
    op: "addColumn";
    table: string;
    key: string;
    column: WireColumnDef;
    before?: string;
}

/**
 * Rewrite one column's builder chain. A `.transform()` already written on it
 * is kept as written.
 *
 * @group Schema
 */
export interface ChangeColumnPatch {
    op: "changeColumn";
    table: string;
    key: string;
    column: WireColumnDef;
}

/**
 * Rename a column's key, in place, with its new definition. To keep the SQL
 * column, the definition carries `column` with the old SQL name.
 *
 * @group Schema
 */
export interface RenameColumnPatch {
    op: "renameColumn";
    table: string;
    key: string;
    to: string;
    column: WireColumnDef;
}

/** Remove a column from `columns`. @group Schema */
export interface RemoveColumnPatch {
    op: "removeColumn";
    table: string;
    key: string;
}

/** Move a column before the column named by `before`, or last. @group Schema */
export interface MoveColumnPatch {
    op: "moveColumn";
    table: string;
    key: string;
    before?: string;
}

/** Add a relation; the target's import is added to the file. @group Schema */
export interface AddRelationPatch {
    op: "addRelation";
    table: string;
    name: string;
    relation: WireRelation;
}

/** Rewrite one relation. @group Schema */
export interface ChangeRelationPatch {
    op: "changeRelation";
    table: string;
    name: string;
    relation: WireRelation;
}

/** Remove a relation; an import nothing else uses is removed with it. @group Schema */
export interface RemoveRelationPatch {
    op: "removeRelation";
    table: string;
    name: string;
}

/**
 * Replace the whole `rls`: a posture, or a list of rules. Prefer the rule
 * operations for a change to one rule — a policy's name is a hash of its rule
 * as written, and they leave every other rule's text alone.
 *
 * @group Schema
 */
export interface SetRlsPatch {
    op: "setRls";
    table: string;
    rls: RlsPosture;
}

/** Insert a rule at `index` (last when omitted) of a table whose `rls` is a list of rules. @group Schema */
export interface AddRulePatch {
    op: "addRule";
    table: string;
    rule: SecurityRule;
    index?: number;
}

/** Replace the rule at `index`; every other rule's text stays byte-identical. @group Schema */
export interface ReplaceRulePatch {
    op: "replaceRule";
    table: string;
    index: number;
    rule: SecurityRule;
}

/** Remove the rule at `index`. The last rule cannot be removed: set `"admin-only"` instead. @group Schema */
export interface RemoveRulePatch {
    op: "removeRule";
    table: string;
    index: number;
}

/**
 * Set a table-level key, or remove it with `value: null`.
 *
 * @group Schema
 */
export type SetTableOptionPatch = {
    [K in TableOptionKey]: { op: "setOption"; table: string; option: K; value: TableOptionValues[K] | null }
}[TableOptionKey];

/**
 * What is wrong with one operation of a {@link TablePatch} list, reported the
 * way a schema problem is: the table, the key when there is one, and what to
 * send instead.
 *
 * @group Schema
 */
export interface TablePatchProblem {
    /** The index of the operation in the list sent. */
    index: number;
    /** The table it names, as sent ("" when none was). */
    table: string;
    /** The column, relation or option key, when the problem is about one. */
    key?: string;
    /** What is wrong and what to send instead. */
    message: string;
}

/**
 * A list of table edits that cannot be applied, with every problem found.
 *
 * @group Schema
 */
export class TablePatchError extends Error {

    readonly code = "TABLE_PATCH_INVALID";

    constructor(
        /** Every problem found, in operation order. */
        readonly problems: readonly TablePatchProblem[]
    ) {
        super(TablePatchError.describe(problems));
        this.name = "TablePatchError";
    }

    private static describe(problems: readonly TablePatchProblem[]): string {
        const lines = problems.map(problem => {
            const table = problem.table || "(no table)";
            const where = problem.key ? `${table}.${problem.key}` : table;
            return `  - edit ${problem.index} (${where}): ${problem.message}`;
        });
        const count = problems.length === 1 ? "1 problem" : `${problems.length} problems`;
        return `The schema edit cannot be applied (${count}):\n${lines.join("\n")}`;
    }
}

/**
 * A name that reaches SQL as an identifier, or becomes a file name: letters,
 * digits, underscores and dollar signs, not starting with a digit. The same
 * alphabet the DDL builders accept, so a name accepted here is one they take.
 */
const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;
/** A key on the JSON row: any non-empty string without control characters. */
const isRowKey = (key: string): boolean => key.length > 0 && [...key].every(char => char.charCodeAt(0) >= 32);

const COLUMN_KINDS = new Set([
    "text", "varchar", "char", "uuid", "enum", "smallint", "integer", "bigint", "smallserial", "serial", "bigserial",
    "real", "doublePrecision", "numeric", "boolean", "timestamptz", "date", "time", "json", "jsonb", "vector", "bytea",
    "array", "other"
]);

const RELATION_OPTION_KEYS: Readonly<Record<WireRelation["kind"], readonly string[]>> = {
    belongsTo: ["localKey", "notNull", "unique", "onDelete", "onUpdate", "index", "constraint", "access", "private"],
    hasOne: ["foreignKey", "sourceKey", "access", "private"],
    hasMany: ["foreignKey", "sourceKey", "orderBy", "access", "private"],
    manyToMany: ["through", "sourceKey", "targetKey", "pivot", "onDelete", "access", "private"],
    via: ["steps", "cardinality", "access", "private"]
};

/** The relation options that name a SQL column or table. */
const RELATION_IDENTIFIER_KEYS = ["localKey", "foreignKey", "sourceKey", "targetKey", "through"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const MIGRATION_KEYS: Readonly<Record<string, string>> = {
    slug: "The slug is the table's address in the API, the SDK, scopes and foreign-key names; renaming it moves data, which is a migration, not an edit. Create a new table and migrate the rows, or rename it in code with a migration.",
    table: "Renaming the SQL table moves its rows, which is a migration, not an edit. Write the rename in code together with a migration.",
    schema: "Moving the table to another Postgres schema moves its rows, which is a migration, not an edit. Write it in code together with a migration.",
    name: "The table's name is its file and its default SQL name; renaming it moves data, which is a migration, not an edit. Write the rename in code together with a migration.",
    database: "Moving the table to another database moves its rows, which is a migration, not an edit."
};

/** Problems with a column definition sent on the wire. */
function columnProblems(value: unknown, where: string): string[] {
    if (!isRecord(value)) return [`${where} must be a column definition object.`];
    const problems: string[] = [];
    const type = value.type;
    if (!isRecord(type) || typeof type.kind !== "string" || !COLUMN_KINDS.has(type.kind)) {
        problems.push(`${where}.type must be a column type, \`{ kind: "text" }\`, \`{ kind: "varchar", length: 160 }\` …`);
    } else if (type.kind === "array") {
        if (!isRecord(type.of)) problems.push(`${where}.type.of must be the type of each item.`);
    } else if ((type.kind === "varchar" || type.kind === "char") && typeof type.length !== "number") {
        problems.push(`${where}.type.length must be a number.`);
    } else if (type.kind === "enum" && (!Array.isArray(type.values) || type.values.length === 0 || !type.values.every(v => typeof v === "string"))) {
        problems.push(`${where}.type.values must be a non-empty list of strings.`);
    } else if (type.kind === "vector" && typeof type.dimensions !== "number") {
        problems.push(`${where}.type.dimensions must be a number.`);
    } else if (type.kind === "other" && typeof type.sqlType !== "string") {
        problems.push(`${where}.type.sqlType must be a string.`);
    }
    for (const flag of ["notNull", "primaryKey", "unique", "readOnly", "private"]) {
        if (value[flag] !== undefined && typeof value[flag] !== "boolean") problems.push(`${where}.${flag} must be a boolean.`);
    }
    if (value.column !== undefined && (typeof value.column !== "string" || !SQL_IDENTIFIER.test(value.column))) {
        problems.push(`${where}.column must be a SQL identifier (letters, digits, underscores; not starting with a digit).`);
    }
    if (value.transform !== undefined) {
        problems.push(`${where}.transform is code: write it in the table's file. A transform already on the column is kept.`);
    }
    if (value.element !== undefined) problems.push(...columnProblems(value.element, `${where}.element`));
    if (value.json !== undefined && !isRecord(value.json)) problems.push(`${where}.json must be a JSON shape.`);
    return problems;
}

/** Problems with a table description sent to be adopted. */
function adoptedTableProblems(spec: Record<string, unknown>): { key?: string; message: string }[] {
    const out: { key?: string; message: string }[] = [];
    for (const key of ["name", "slug", "table", "schema"] as const) {
        const named = spec[key];
        if (typeof named !== "string" || !SQL_IDENTIFIER.test(named)) out.push({ key, message: `\`${key}\` must be a SQL identifier.` });
    }
    if (spec.kind !== "table") out.push({ key: "kind", message: "only a table can be adopted (`kind: \"table\"`)." });
    if (!Array.isArray(spec.columns) || spec.columns.length === 0) {
        out.push({ key: "columns", message: "`columns` must list the table's columns, as introspection described them." });
    } else {
        for (const [index, column] of spec.columns.entries()) {
            const key = isRecord(column) && typeof column.key === "string" ? column.key : `columns[${index}]`;
            if (!isRecord(column) || typeof column.key !== "string" || !isRowKey(column.key)) out.push({ key, message: "a column must have a `key`." });
            else if (typeof column.nullable !== "boolean") out.push({ key, message: "`nullable` must be a boolean." });
            for (const message of columnProblems(column, `columns.${key}`)) out.push({ key, message });
        }
    }
    if (!Array.isArray(spec.primaryKey) || spec.primaryKey.length === 0 || !spec.primaryKey.every(key => typeof key === "string")) {
        out.push({ key: "primaryKey", message: "`primaryKey` must name the key column (or columns): a table without one cannot be declared." });
    }
    if (!Array.isArray(spec.relations) || !spec.relations.every(isRecord)) out.push({ key: "relations", message: "`relations` must be a list of relations." });
    const rls = spec.rls;
    if (!isRecord(rls) || (rls.posture !== "admin-only" && rls.posture !== "rules") || !Array.isArray(rls.rules) || !rls.rules.every(isRecord)) {
        out.push({ key: "rls", message: "`rls` must be `{ posture, rules }`, as introspection described it." });
    }
    if (spec.hooks !== undefined) out.push({ key: "hooks", message: "hooks are code: write them in the table's file once it is adopted." });
    if (spec.auth !== undefined || spec.view !== undefined) out.push({ message: "an auth table or a view is not adopted here: declare it in code." });
    return out;
}

/** Problems with a relation sent on the wire. */
function relationProblems(value: unknown, where: string): string[] {
    if (!isRecord(value)) return [`${where} must be a relation object.`];
    const kind = value.kind;
    if (kind !== "belongsTo" && kind !== "hasOne" && kind !== "hasMany" && kind !== "manyToMany" && kind !== "via") {
        return [`${where}.kind must be one of belongsTo, hasOne, hasMany, manyToMany, via.`];
    }
    const problems: string[] = [];
    if (typeof value.target !== "string" || value.target.trim() === "") {
        problems.push(`${where}.target must be the slug of the table it points at.`);
    }
    const known = RELATION_OPTION_KEYS[kind];
    for (const key of Object.keys(value)) {
        if (key === "kind" || key === "target") continue;
        if (!known.includes(key)) problems.push(`${where}.${key} is not an option of \`rel.${kind}\`.`);
    }
    for (const key of RELATION_IDENTIFIER_KEYS) {
        const named = value[key];
        if (named !== undefined && (typeof named !== "string" || !SQL_IDENTIFIER.test(named))) {
            problems.push(`${where}.${key} must be a SQL identifier.`);
        }
    }
    if (kind === "via" && (!Array.isArray(value.steps) || value.steps.length === 0)) {
        problems.push(`${where}.steps must list at least one join step.`);
    }
    if (kind === "manyToMany" && value.pivot !== undefined) {
        if (!isRecord(value.pivot)) problems.push(`${where}.pivot must map column keys to column definitions.`);
        else for (const [key, column] of Object.entries(value.pivot)) problems.push(...columnProblems(column, `${where}.pivot.${key}`));
    }
    return problems;
}

/** Problems with an `rls` value sent on the wire. */
function rlsProblems(value: unknown, where: string): string[] {
    if (value === "admin-only" || value === "inherit") return [];
    if (!Array.isArray(value)) return [`${where} must be "admin-only", "inherit" or a list of rules.`];
    if (value.length === 0) return [`${where} is an empty list of rules, which leaves nobody a policy. Send "admin-only" instead.`];
    return value.flatMap((rule, index) => (isRecord(rule) ? [] : [`${where}[${index}] must be a rule object.`]));
}

/** Problems with a table-level option's value. */
function optionProblems(option: TableOptionKey, value: unknown, where: string): string[] {
    if (value === null) return [];
    switch (option) {
        case "description":
            return typeof value === "string" ? [] : [`${where} must be a string.`];
        case "history":
            return typeof value === "boolean" ? [] : [`${where} must be a boolean.`];
        case "strictWrites":
        case "defaultPolicies":
            return value === false ? [] : [`${where} can only be \`false\` (or \`null\` to remove it).`];
        case "softDelete":
            return typeof value === "boolean" || isRecord(value) ? [] : [`${where} must be a boolean or \`{ field }\`.`];
        case "tenant":
            return isRecord(value) && typeof value.field === "string" && isRecord(value.from) ? [] : [`${where} must be \`{ field, from }\`.`];
        case "search":
        case "metadata":
            return isRecord(value) ? [] : [`${where} must be an object.`];
        case "indexes":
            return Array.isArray(value) && value.every(isRecord) ? [] : [`${where} must be a list of indexes.`];
    }
}

const isOptionKey = (value: unknown): value is TableOptionKey =>
    typeof value === "string" && (TABLE_OPTION_KEYS as readonly string[]).includes(value);

const isIndex = (value: unknown): boolean => typeof value === "number" && Number.isInteger(value) && value >= 0;

/** The problems of one operation. */
function operationProblems(value: unknown, index: number): TablePatchProblem[] {
    if (!isRecord(value)) return [{ index, table: "", message: "an edit must be an object with an `op`." }];
    const table = typeof value.table === "string" ? value.table : "";
    const problem = (message: string, key?: string): TablePatchProblem => ({ index, table, ...(key !== undefined ? { key } : {}), message });
    const op = value.op;

    if (op === "createTable") {
        const spec = value.table;
        if (!isRecord(spec)) return [{ index, table: "", message: "`table` must describe the new table: `{ name, columns, rls }`." }];
        const name = typeof spec.name === "string" ? spec.name : "";
        const out: TablePatchProblem[] = [];
        const at = (message: string, key?: string): void => {
            out.push({ index, table: name, ...(key !== undefined ? { key } : {}), message });
        };
        if (!SQL_IDENTIFIER.test(name)) at("`name` must be a SQL identifier: it names the table and its file.");
        for (const key of ["slug", "table", "schema"] as const) {
            const named = spec[key];
            if (named !== undefined && (typeof named !== "string" || !SQL_IDENTIFIER.test(named))) at(`\`${key}\` must be a SQL identifier.`, key);
        }
        if (!isRecord(spec.columns) || Object.keys(spec.columns).length === 0) {
            at("`columns` must declare at least one column (one of them `primaryKey`).");
        } else {
            for (const [key, column] of Object.entries(spec.columns)) {
                if (!isRowKey(key)) at("a column key must be a non-empty string.", key);
                for (const message of columnProblems(column, `columns.${key}`)) at(message, key);
            }
        }
        if (spec.relations !== undefined) {
            if (!isRecord(spec.relations)) at("`relations` must map relation names to relations.");
            else for (const [key, relation] of Object.entries(spec.relations)) {
                for (const message of relationProblems(relation, `relations.${key}`)) at(message, key);
            }
        }
        for (const message of rlsProblems(spec.rls, "rls")) at(message, "rls");
        for (const option of TABLE_OPTION_KEYS) {
            if (spec[option] === undefined) continue;
            for (const message of optionProblems(option, spec[option], option)) at(message, option);
        }
        const known = new Set<string>(["name", "slug", "table", "schema", "columns", "relations", "rls", ...TABLE_OPTION_KEYS]);
        for (const key of Object.keys(spec)) {
            if (!known.has(key)) at(`\`${key}\` is not something the schema editor writes${key === "hooks" ? ": hooks are code, write them in the file" : ""}.`, key);
        }
        return out;
    }

    if (op === "adoptTable") {
        const spec = value.table;
        if (!isRecord(spec)) return [{ index, table: "", message: "`table` must be the description of the table to adopt, as `GET …/unmapped-tables/:schema/:table` serves it." }];
        const name = typeof spec.slug === "string" ? spec.slug : "";
        return adoptedTableProblems(spec).map(found => ({ index, table: name, ...(found.key !== undefined ? { key: found.key } : {}), message: found.message }));
    }

    if (table === "") return [problem("`table` must be the slug of the table to edit.")];

    switch (op) {
        case "deleteTable":
            return [];
        case "addColumn":
        case "changeColumn": {
            const out: TablePatchProblem[] = [];
            const key = typeof value.key === "string" ? value.key : undefined;
            if (key === undefined || !isRowKey(key)) out.push(problem("`key` must name the column."));
            for (const message of columnProblems(value.column, "column")) out.push(problem(message, key));
            if (op === "addColumn" && value.before !== undefined && typeof value.before !== "string") out.push(problem("`before` must name a column.", key));
            return out;
        }
        case "renameColumn": {
            const out: TablePatchProblem[] = [];
            const key = typeof value.key === "string" ? value.key : undefined;
            if (key === undefined) out.push(problem("`key` must name the column."));
            if (typeof value.to !== "string" || !isRowKey(value.to)) out.push(problem("`to` must be the column's new key.", key));
            for (const message of columnProblems(value.column, "column")) out.push(problem(message, key));
            return out;
        }
        case "removeColumn":
            return typeof value.key === "string" ? [] : [problem("`key` must name the column.")];
        case "moveColumn": {
            if (typeof value.key !== "string") return [problem("`key` must name the column.")];
            return value.before === undefined || typeof value.before === "string" ? [] : [problem("`before` must name a column.", value.key)];
        }
        case "addRelation":
        case "changeRelation": {
            const name = typeof value.name === "string" ? value.name : undefined;
            const out = name === undefined || !isRowKey(name) ? [problem("`name` must name the relation.")] : [];
            return [...out, ...relationProblems(value.relation, "relation").map(message => problem(message, name))];
        }
        case "removeRelation":
            return typeof value.name === "string" ? [] : [problem("`name` must name the relation.")];
        case "setRls":
            return rlsProblems(value.rls, "rls").map(message => problem(message, "rls"));
        case "addRule":
            return [
                ...(isRecord(value.rule) ? [] : [problem("`rule` must be a rule object.", "rls")]),
                ...(value.index === undefined || isIndex(value.index) ? [] : [problem("`index` must be a position in the rules.", "rls")])
            ];
        case "replaceRule":
            return [
                ...(isRecord(value.rule) ? [] : [problem("`rule` must be a rule object.", "rls")]),
                ...(isIndex(value.index) ? [] : [problem("`index` must be a position in the rules.", "rls")])
            ];
        case "removeRule":
            return isIndex(value.index) ? [] : [problem("`index` must be a position in the rules.", "rls")];
        case "setOption": {
            const option = value.option;
            if (typeof option === "string" && option in MIGRATION_KEYS) return [problem(MIGRATION_KEYS[option], option)];
            if (option === "hooks") return [problem("hooks are code: write them in the table's file.", option)];
            if (!isOptionKey(option)) {
                return [problem(`\`option\` must be one of ${TABLE_OPTION_KEYS.join(", ")}.`, typeof option === "string" ? option : undefined)];
            }
            if (!("value" in value)) return [problem("`value` is required: the new value, or `null` to remove the key.", option)];
            return optionProblems(option, value.value, "value").map(message => problem(message, option));
        }
        default:
            return [problem(`\`op\` ${JSON.stringify(op)} is not a schema edit. Send one of createTable, adoptTable, deleteTable, addColumn, changeColumn, renameColumn, removeColumn, moveColumn, addRelation, changeRelation, removeRelation, setRls, addRule, replaceRule, removeRule, setOption.`)];
    }
}

/**
 * Every problem with a list of table edits as it arrived, in operation order.
 * Empty when the list is well formed — which says nothing about whether the
 * result compiles: the server compiles it before writing anything.
 *
 * @group Schema
 */
export function tablePatchProblems(value: unknown): TablePatchProblem[] {
    if (!Array.isArray(value)) return [{ index: 0, table: "", message: "`patches` must be a list of schema edits." }];
    if (value.length === 0) return [{ index: 0, table: "", message: "`patches` is empty: there is nothing to edit." }];
    return value.flatMap((operation, index) => operationProblems(operation, index));
}

/**
 * Whether a value is a well-formed list of {@link TablePatch} operations.
 *
 * @group Schema
 */
export function isTablePatchList(value: unknown): value is TablePatch[] {
    return tablePatchProblems(value).length === 0;
}

/**
 * A list of edits as it arrived, checked: the list, or a
 * {@link TablePatchError} naming every problem.
 *
 * @group Schema
 */
export function parseTablePatches(value: unknown): TablePatch[] {
    if (isTablePatchList(value)) return value;
    throw new TablePatchError(tablePatchProblems(value));
}

/**
 * The column definition a {@link WireColumnDef} stands for, the flags it left
 * out `false`.
 *
 * @group Schema
 */
export function columnDefFromWire(column: WireColumnDef): ColumnDef {
    const { element, json, notNull, primaryKey, unique, readOnly, private: isPrivate, ...rest } = column;
    const def: ColumnDef = {
        ...rest,
        notNull: notNull === true,
        primaryKey: primaryKey === true,
        unique: unique === true,
        readOnly: readOnly === true,
        private: isPrivate === true
    };
    if (element !== undefined) def.element = columnDefFromWire(element);
    if (json !== undefined) def.json = json;
    return def;
}

/** Deep equality of JSON-like values: what a rule read from the wire is compared by. */
function sameValue(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (Array.isArray(a) || Array.isArray(b)) {
        return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
    }
    if (!isRecord(a) || !isRecord(b)) return false;
    const keys = Object.keys(a).filter(key => a[key] !== undefined);
    const otherKeys = Object.keys(b).filter(key => b[key] !== undefined);
    return keys.length === otherKeys.length && keys.every(key => sameValue(a[key], b[key]));
}

/**
 * The rule operations that turn one list of rules into another, touching only
 * the rules that changed.
 *
 * A policy's name is a hash of its rule as written, so an editor that sends
 * the whole list back (one `setRls`) would rewrite every rule's text and risk
 * renaming policies it never changed. This pairs the lists by position: an
 * equal rule is left alone, a different one is replaced, a longer list adds
 * rules and a shorter one removes from the end. Positions are those of the
 * list as it is when each operation runs.
 *
 * @group Schema
 */
export function rulePatches(table: string, before: readonly SecurityRule[], after: readonly SecurityRule[]): TablePatch[] {
    const out: TablePatch[] = [];
    const shared = Math.min(before.length, after.length);
    for (let index = 0; index < shared; index++) {
        if (!sameValue(before[index], after[index])) out.push({ op: "replaceRule", table, index, rule: after[index] });
    }
    for (let index = shared; index < after.length; index++) out.push({ op: "addRule", table, rule: after[index], index });
    for (let index = before.length - 1; index >= after.length; index--) out.push({ op: "removeRule", table, index });
    return out;
}
