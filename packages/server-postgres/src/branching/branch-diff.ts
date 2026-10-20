/**
 * What a database branch changed, and applying it to the database it was made
 * from.
 *
 * A branch is a `CREATE DATABASE … TEMPLATE` copy (see `BranchService`): a
 * database of its own, on the same server. Two databases cannot be joined in
 * one query, so each side is read on its own through `SQLAdmin.executeSql`
 * with `database`, and compared here.
 *
 * ## Which side changed a row
 *
 * Comparing the two databases says which rows differ, not who changed them: a
 * row the target inserted after the branch was made looks exactly like a row
 * the branch deleted. A merge that took every difference as the branch's would
 * delete everything the target wrote meanwhile.
 *
 * Transaction ids are the server's, not a database's, and the template copy
 * keeps every row's `xmin`. So a row written after the branch was made — on
 * either side — has an `xmin` younger than the transaction that created the
 * branch database, which is the `xmin` of its `pg_database` row. That is the
 * fork point, and with it each difference has an author:
 *
 * | branch row          | target row          | the change                     |
 * |---------------------|---------------------|--------------------------------|
 * | younger             | absent              | the branch inserted it         |
 * | absent              | older               | the branch deleted it          |
 * | younger             | older               | the branch updated it          |
 * | older or absent     | younger or absent   | the target changed it: kept    |
 * | younger             | younger             | both changed it: a conflict    |
 *
 * Two cases cannot be told apart and are read the way that loses nothing: a
 * row the branch deleted and the target then changed is the target's change,
 * and kept; a row the target deleted and the branch then changed is the
 * branch's insert. An update that wrote the same values still counts as a
 * write, so it can make a conflict of a row only one side meant to change.
 *
 * When the fork point cannot be read — the `pg_database` row was frozen by a
 * vacuum, or rewritten by an `ALTER DATABASE` — every difference is counted as
 * the branch's and the diff says so (`forkPointKnown: false`).
 *
 * ## What a merge does
 *
 * See `BranchMergeOptions` in `@rebasepro/types`. In short: the branch's
 * inserts, updates and deletes, in one statement on the target, all or none;
 * the target's own changes kept; nothing at all when either side moved since
 * the reviewed diff. Schema and policies are never merged.
 */
import { createHash } from "node:crypto";
import {
    isBranchAdmin,
    isSQLAdmin,
    type BranchAdmin,
    type BranchDiff,
    type BranchDiffOptions,
    type BranchMergeBlock,
    type BranchMergeOptions,
    type BranchMergeResult,
    type BranchRowChange,
    type BranchSchemaChange,
    type BranchTableDataDiff,
    type DatabaseAdmin,
    type SQLAdmin
} from "@rebasepro/types";
import { isRebaseInternalTable } from "@rebasepro/common";
import { ApiError } from "@rebasepro/server";

/** Rows shown per table when the caller does not say. */
export const DEFAULT_BRANCH_DIFF_SAMPLE_LIMIT = 100;

/** Rows a table may hold, per side, to be matched row by row, when the caller does not say. */
export const DEFAULT_BRANCH_DIFF_MAX_ROWS = 100_000;

/** The age Postgres gives a frozen or permanent transaction id. */
const FROZEN_AGE = 2147483647;

export type BranchDiffErrorCode =
    | "BRANCH_DIFF_UNSUPPORTED"
    | "BRANCH_NOT_FOUND"
    | "BRANCH_DIFF_STALE"
    | "BRANCH_MERGE_BLOCKED"
    | "BRANCH_MERGE_CONFLICT"
    | "INVALID_INPUT";

const STATUS: Record<BranchDiffErrorCode, number> = {
    BRANCH_DIFF_UNSUPPORTED: 501,
    BRANCH_NOT_FOUND: 404,
    BRANCH_DIFF_STALE: 409,
    BRANCH_MERGE_BLOCKED: 409,
    BRANCH_MERGE_CONFLICT: 409,
    INVALID_INPUT: 400
};

/**
 * A refusal, with the status a route answers it with and the tables it is
 * about. Every one is the caller's to act on, so none logs as a warning.
 */
export class BranchDiffError extends ApiError {
    constructor(
        code: BranchDiffErrorCode,
        message: string,
        tables?: { schema: string; table: string; reason: string }[]
    ) {
        super(STATUS[code], code, message, tables ? { tables } : undefined, true);
        this.name = "BranchDiffError";
    }
}

// ── Reading rows ─────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

function text(row: Row, key: string): string {
    const value = row[key];
    if (typeof value === "string") return value;
    return value === null || value === undefined ? "" : String(value);
}

function nullableText(row: Row, key: string): string | null {
    const value = row[key];
    if (value === null || value === undefined) return null;
    return typeof value === "string" ? value : String(value);
}

function flag(row: Row, key: string): boolean {
    const value = row[key];
    return value === true || value === "t" || value === "true";
}

function stringList(json: string): string[] {
    const parsed: unknown = JSON.parse(json || "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

/** A row as `json_object_agg` over `json_each_text` writes it: every value text or null. */
function textRecord(json: string): Record<string, string | null> {
    const parsed: unknown = JSON.parse(json);
    const record: Record<string, string | null> = {};
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return record;
    for (const [key, value] of Object.entries(parsed)) {
        record[key] = typeof value === "string" ? value : null;
    }
    return record;
}

const md5 = (value: string): string => createHash("md5").update(value, "utf8").digest("hex");

// ── SQL text ─────────────────────────────────────────────────────────────────

function ident(name: string): string {
    return `"${name.replace(/"/g, "\"\"")}"`;
}

function qualified(schema: string, table: string): string {
    return `${ident(schema)}.${ident(table)}`;
}

/**
 * The schemas a query reads, given `$1`: the ones asked for, or every schema
 * but the system's.
 */
function schemaFilter(column: string): string {
    return `(CASE WHEN $1::text[] IS NULL
                THEN ${column} NOT LIKE 'pg\\_%' AND ${column} <> 'information_schema'
                ELSE ${column} = ANY($1::text[]) END)`;
}

/** The primary key of `t` as a JSON array: unique, and lossless for any type. */
function keyExpression(primaryKey: readonly string[]): string {
    return `json_build_array(${primaryKey.map((column) => `t.${ident(column)}`).join(", ")})::text`;
}

/**
 * A digest of `t`'s values in `columns`. A row constructor rather than a
 * function call, which would stop at 100 columns. The same columns, of the
 * same types, write the same text on both sides.
 */
function hashExpression(columns: readonly string[]): string {
    return `md5(ROW(${columns.map((column) => `t.${ident(column)}`).join(", ")})::text)`;
}

// ── The catalogue ────────────────────────────────────────────────────────────

export interface ColumnFacts {
    name: string;
    type: string;
    notNull: boolean;
    defaultExpression: string | null;
    /** `s` for a stored generated column. */
    generated: string;
    /** `a` for GENERATED ALWAYS, `d` for BY DEFAULT. */
    identity: string;
    sequence: string | null;
}

export interface PolicyFacts {
    name: string;
    permissive: string;
    roles: string[];
    command: string;
    using: string | null;
    withCheck: string | null;
}

export interface TableFacts {
    schema: string;
    table: string;
    rls: boolean;
    forceRls: boolean;
    columns: ColumnFacts[];
    primaryKey: string[];
    policies: PolicyFacts[];
}

/** Tables by `schema.table`, as a JSON pair so no name can collide with another. */
export type Catalog = Map<string, TableFacts>;

const tableKey = (schema: string, table: string): string => JSON.stringify([schema, table]);

const TABLE_FILTER = `c.relkind IN ('r', 'p') AND NOT c.relispartition
    AND NOT EXISTS (SELECT 1 FROM pg_depend dep
                     WHERE dep.classid = 'pg_class'::regclass AND dep.objid = c.oid AND dep.deptype = 'e')`;

const TABLES_SQL = `
SELECT n.nspname AS schema_name, c.relname AS table_name,
       c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE ${TABLE_FILTER} AND ${schemaFilter("n.nspname")}`;

const COLUMNS_SQL = `
SELECT n.nspname AS schema_name, c.relname AS table_name, a.attname AS column_name,
       format_type(a.atttypid, a.atttypmod) AS data_type, a.attnotnull AS not_null,
       pg_get_expr(ad.adbin, ad.adrelid) AS default_expr,
       a.attgenerated::text AS generated, a.attidentity::text AS identity,
       pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname) AS sequence_name
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
 WHERE a.attnum > 0 AND NOT a.attisdropped AND ${TABLE_FILTER} AND ${schemaFilter("n.nspname")}
 ORDER BY n.nspname, c.relname, a.attnum`;

const PRIMARY_KEYS_SQL = `
SELECT n.nspname AS schema_name, c.relname AS table_name,
       json_agg(a.attname::text ORDER BY k.ord)::text AS columns
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
 WHERE i.indisprimary AND ${schemaFilter("n.nspname")}
 GROUP BY n.nspname, c.relname`;

const POLICIES_SQL = `
SELECT schemaname::text AS schema_name, tablename::text AS table_name, policyname::text AS policy_name,
       permissive, array_to_json(roles)::text AS roles, cmd, qual, with_check
  FROM pg_policies
 WHERE ${schemaFilter("schemaname::text")}
 ORDER BY schemaname, tablename, policyname`;

async function readCatalog(sql: SQLAdmin, database: string, schemas: string[] | null): Promise<Catalog> {
    const params = [schemas];
    const [tables, columns, primaryKeys, policies] = await Promise.all([
        sql.executeSql(TABLES_SQL, { database, params }),
        sql.executeSql(COLUMNS_SQL, { database, params }),
        sql.executeSql(PRIMARY_KEYS_SQL, { database, params }),
        sql.executeSql(POLICIES_SQL, { database, params })
    ]);
    const catalog: Catalog = new Map();
    for (const row of tables) {
        const schema = text(row, "schema_name");
        const table = text(row, "table_name");
        // Rebase's own plumbing — sessions, history, the branch registry —
        // changes on every request and is nothing a branch is reviewed for.
        if (isRebaseInternalTable(table, schema)) continue;
        catalog.set(tableKey(schema, table), {
            schema,
            table,
            rls: flag(row, "rls"),
            forceRls: flag(row, "force_rls"),
            columns: [],
            primaryKey: [],
            policies: []
        });
    }
    for (const row of columns) {
        const facts = catalog.get(tableKey(text(row, "schema_name"), text(row, "table_name")));
        facts?.columns.push({
            name: text(row, "column_name"),
            type: text(row, "data_type"),
            notNull: flag(row, "not_null"),
            defaultExpression: nullableText(row, "default_expr"),
            generated: text(row, "generated"),
            identity: text(row, "identity"),
            sequence: nullableText(row, "sequence_name")
        });
    }
    for (const row of primaryKeys) {
        const facts = catalog.get(tableKey(text(row, "schema_name"), text(row, "table_name")));
        if (facts) facts.primaryKey = stringList(text(row, "columns"));
    }
    for (const row of policies) {
        const facts = catalog.get(tableKey(text(row, "schema_name"), text(row, "table_name")));
        facts?.policies.push({
            name: text(row, "policy_name"),
            permissive: text(row, "permissive"),
            roles: stringList(text(row, "roles")),
            command: text(row, "cmd"),
            using: nullableText(row, "qual"),
            withCheck: nullableText(row, "with_check")
        });
    }
    return catalog;
}

// ── Schema, as SQL ───────────────────────────────────────────────────────────

/** A column as it would be declared in `CREATE TABLE`. */
export function columnDefinitionSql(column: ColumnFacts): string {
    const parts = [ident(column.name), column.type];
    if (column.generated === "s") {
        parts.push(`GENERATED ALWAYS AS (${column.defaultExpression ?? ""}) STORED`);
    } else if (column.identity === "a" || column.identity === "d") {
        parts.push(`GENERATED ${column.identity === "a" ? "ALWAYS" : "BY DEFAULT"} AS IDENTITY`);
    }
    if (column.notNull) parts.push("NOT NULL");
    if (column.generated !== "s" && column.defaultExpression !== null) parts.push(`DEFAULT ${column.defaultExpression}`);
    return parts.join(" ");
}

function rlsSql(facts: TableFacts): string {
    const table = qualified(facts.schema, facts.table);
    return [
        `ALTER TABLE ${table} ${facts.rls ? "ENABLE" : "DISABLE"} ROW LEVEL SECURITY;`,
        `ALTER TABLE ${table} ${facts.forceRls ? "FORCE" : "NO FORCE"} ROW LEVEL SECURITY;`
    ].join("\n");
}

export function tableSql(facts: TableFacts): string {
    const lines = facts.columns.map((column) => `    ${columnDefinitionSql(column)}`);
    if (facts.primaryKey.length > 0) lines.push(`    PRIMARY KEY (${facts.primaryKey.map(ident).join(", ")})`);
    const create = `CREATE TABLE ${qualified(facts.schema, facts.table)} (\n${lines.join(",\n")}\n);`;
    return facts.rls || facts.forceRls ? `${create}\n${rlsSql(facts)}` : create;
}

export function policySql(schema: string, table: string, policy: PolicyFacts): string {
    const roles = policy.roles.map((role) => role === "public" ? "public" : ident(role)).join(", ");
    const lines = [
        `CREATE POLICY ${ident(policy.name)} ON ${qualified(schema, table)}`,
        `    AS ${policy.permissive}`,
        `    FOR ${policy.command}`,
        `    TO ${roles || "public"}`
    ];
    if (policy.using !== null) lines.push(`    USING (${policy.using})`);
    if (policy.withCheck !== null) lines.push(`    WITH CHECK (${policy.withCheck})`);
    return `${lines.join("\n")};`;
}

function primaryKeySql(facts: TableFacts): string {
    return facts.primaryKey.length === 0
        ? `-- ${qualified(facts.schema, facts.table)} has no primary key`
        : `ALTER TABLE ${qualified(facts.schema, facts.table)} ADD PRIMARY KEY (${facts.primaryKey.map(ident).join(", ")});`;
}

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
    a.length === b.length && a.every((item, index) => item === b[index]);

/**
 * The schema changes from `target` to `branch`: tables, columns, primary keys,
 * row-level security and policies, ordered by table.
 */
export function diffCatalogs(target: Catalog, branch: Catalog): BranchSchemaChange[] {
    const changes: BranchSchemaChange[] = [];
    const keys = [...new Set([...target.keys(), ...branch.keys()])].sort();
    for (const key of keys) {
        const before = target.get(key);
        const after = branch.get(key);
        const facts = after ?? before;
        if (!facts) continue;
        const { schema, table } = facts;
        if (!before && after) {
            changes.push({ object: "table", change: "added", schema, table, after: tableSql(after) });
        } else if (before && !after) {
            changes.push({ object: "table", change: "dropped", schema, table, before: tableSql(before) });
        } else if (before && after) {
            if (!sameList(before.primaryKey, after.primaryKey)) {
                changes.push({ object: "table", change: "altered", schema, table, before: primaryKeySql(before), after: primaryKeySql(after) });
            }
            const columnsBefore = new Map(before.columns.map((column) => [column.name, column]));
            const columnsAfter = new Map(after.columns.map((column) => [column.name, column]));
            for (const column of after.columns) {
                const old = columnsBefore.get(column.name);
                const definition = columnDefinitionSql(column);
                if (!old) {
                    changes.push({ object: "column", change: "added", schema, table, name: column.name, after: definition });
                } else if (columnDefinitionSql(old) !== definition) {
                    changes.push({ object: "column", change: "altered", schema, table, name: column.name, before: columnDefinitionSql(old), after: definition });
                }
            }
            for (const column of before.columns) {
                if (!columnsAfter.has(column.name)) {
                    changes.push({ object: "column", change: "dropped", schema, table, name: column.name, before: columnDefinitionSql(column) });
                }
            }
            if (before.rls !== after.rls || before.forceRls !== after.forceRls) {
                changes.push({ object: "rls", change: "altered", schema, table, before: rlsSql(before), after: rlsSql(after) });
            }
        }
        const policiesBefore = new Map((before?.policies ?? []).map((policy) => [policy.name, policy]));
        const policiesAfter = new Map((after?.policies ?? []).map((policy) => [policy.name, policy]));
        for (const [name, policy] of policiesAfter) {
            const old = policiesBefore.get(name);
            const definition = policySql(schema, table, policy);
            if (!old) {
                changes.push({ object: "policy", change: "added", schema, table, name, after: definition });
            } else if (policySql(schema, table, old) !== definition) {
                changes.push({ object: "policy", change: "altered", schema, table, name, before: policySql(schema, table, old), after: definition });
            }
        }
        for (const [name, policy] of policiesBefore) {
            if (!policiesAfter.has(name)) {
                changes.push({ object: "policy", change: "dropped", schema, table, name, before: policySql(schema, table, policy) });
            }
        }
    }
    return changes;
}

// ── Rows ─────────────────────────────────────────────────────────────────────

/** One row's key, the digest of its values, and whether it was written after the fork. */
export interface RowState {
    key: string;
    hash: string;
    young: boolean;
}

export interface RowClassification {
    inserted: string[];
    updated: string[];
    deleted: string[];
    conflicts: string[];
    targetChanges: number;
}

/**
 * Who changed each row that differs — see the table in the module comment.
 * Without a fork point every difference is the branch's.
 */
export function classifyRows(target: readonly RowState[], branch: readonly RowState[], forkPointKnown: boolean): RowClassification {
    const result: RowClassification = { inserted: [], updated: [], deleted: [], conflicts: [], targetChanges: 0 };
    const targetByKey = new Map(target.map((row) => [row.key, row]));
    const branchKeys = new Set<string>();
    for (const row of branch) {
        branchKeys.add(row.key);
        const old = targetByKey.get(row.key);
        const branchWrote = !forkPointKnown || row.young;
        if (!old) {
            if (branchWrote) result.inserted.push(row.key);
            else result.targetChanges += 1;
            continue;
        }
        if (old.hash === row.hash) continue;
        const targetWrote = forkPointKnown && old.young;
        if (branchWrote && !targetWrote) result.updated.push(row.key);
        else if (!branchWrote && targetWrote) result.targetChanges += 1;
        else result.conflicts.push(row.key);
    }
    for (const row of target) {
        if (branchKeys.has(row.key)) continue;
        if (forkPointKnown && row.young) result.targetChanges += 1;
        else result.deleted.push(row.key);
    }
    return result;
}

/** Up to `limit` keys, taken in turn from each kind so that no kind crowds out the rest. */
export function pickSamples(kinds: readonly (readonly string[])[], limit: number): string[][] {
    const picked = kinds.map((): string[] => []);
    let remaining = limit;
    for (let index = 0; remaining > 0; index += 1) {
        let took = false;
        for (let kind = 0; kind < kinds.length && remaining > 0; kind += 1) {
            const key = kinds[kind][index];
            if (key === undefined) continue;
            picked[kind].push(key);
            remaining -= 1;
            took = true;
        }
        if (!took) break;
    }
    return picked;
}

/** What a merge needs to know about a table the diff matched row by row. */
interface MatchedTable {
    facts: TableFacts;
    keyExpression: string;
    hashExpression: string;
    /** `md5` of every `key:hash` on the target, in `"C"` key order — what the merge's guard recomputes. */
    targetDigest: string;
    branchHashes: Map<string, string>;
    rows: RowClassification;
}

interface ComputedDiff {
    diff: BranchDiff;
    matched: Map<string, MatchedTable>;
}

async function rowStates(
    sql: SQLAdmin,
    database: string,
    facts: TableFacts,
    keyExpr: string,
    hashExpr: string,
    forkDatabase: string | null
): Promise<RowState[]> {
    const young = forkDatabase === null
        ? "false"
        : "(age(t.xmin) < (SELECT age(d.xmin) FROM pg_database d WHERE d.datname = $1))";
    const rows = await sql.executeSql(
        `SELECT ${keyExpr} AS k, ${hashExpr} AS h, ${young} AS young
           FROM ${qualified(facts.schema, facts.table)} t
          ORDER BY (${keyExpr}) COLLATE "C"`,
        { database, params: forkDatabase === null ? undefined : [forkDatabase] }
    );
    return rows.map((row) => ({ key: text(row, "k"), hash: text(row, "h"), young: flag(row, "young") }));
}

/** Each table's row count and an order-free checksum of its rows, on one side, in one query. */
async function checksums(
    sql: SQLAdmin,
    database: string,
    tables: readonly { facts: TableFacts; keyExpr: string; hashExpr: string }[]
): Promise<{ count: number; sum: string }[]> {
    if (tables.length === 0) return [];
    const parts = tables.map(({ facts, keyExpr, hashExpr }, index) =>
        `SELECT ${index} AS idx, count(*)::text AS n,
                coalesce(sum(('x' || left(md5(${keyExpr} || ':' || ${hashExpr}), 15))::bit(60)::bigint), 0)::text AS s
           FROM ${qualified(facts.schema, facts.table)} t`);
    const rows = await sql.executeSql(parts.join("\nUNION ALL\n"), { database });
    const result = tables.map(() => ({ count: 0, sum: "0" }));
    for (const row of rows) {
        const index = Number(text(row, "idx"));
        result[index] = { count: Number(text(row, "n")), sum: text(row, "s") };
    }
    return result;
}

async function sampleRows(
    sql: SQLAdmin,
    database: string,
    facts: TableFacts,
    keyExpr: string,
    keys: readonly string[]
): Promise<Map<string, Record<string, string | null>>> {
    const found = new Map<string, Record<string, string | null>>();
    if (keys.length === 0) return found;
    const rows = await sql.executeSql(
        `SELECT ${keyExpr} AS k,
                (SELECT json_object_agg(e.key, e.value) FROM json_each_text(row_to_json(t)) e)::text AS r
           FROM ${qualified(facts.schema, facts.table)} t
          WHERE ${keyExpr} = ANY($1::text[])`,
        { database, params: [[...keys]] }
    );
    for (const row of rows) found.set(text(row, "k"), textRecord(text(row, "r")));
    return found;
}

async function firstRows(sql: SQLAdmin, database: string, facts: TableFacts, limit: number): Promise<{ key: string; row: Record<string, string | null> }[]> {
    if (limit <= 0) return [];
    const keyExpr = facts.primaryKey.length > 0 ? keyExpression(facts.primaryKey) : "'[]'";
    const rows = await sql.executeSql(
        `SELECT ${keyExpr} AS k,
                (SELECT json_object_agg(e.key, e.value) FROM json_each_text(row_to_json(t)) e)::text AS r
           FROM ${qualified(facts.schema, facts.table)} t
          LIMIT ${Math.floor(limit)}`,
        { database }
    );
    return rows.map((row) => ({ key: text(row, "k"), row: textRecord(text(row, "r")) }));
}

async function countRows(sql: SQLAdmin, database: string, facts: TableFacts): Promise<number> {
    const [row] = await sql.executeSql(`SELECT count(*)::text AS n FROM ${qualified(facts.schema, facts.table)}`, { database });
    return row ? Number(text(row, "n")) : 0;
}

function emptyTableDiff(facts: TableFacts): BranchTableDataDiff {
    return {
        schema: facts.schema,
        table: facts.table,
        primaryKey: facts.primaryKey,
        inserted: 0,
        updated: 0,
        deleted: 0,
        conflicts: 0,
        targetChanges: 0,
        samples: []
    };
}

function positiveInteger(value: number | undefined, fallback: number, name: string, allowZero: boolean): number {
    if (value === undefined) return fallback;
    if (!Number.isInteger(value) || value < (allowZero ? 0 : 1)) {
        throw new BranchDiffError("INVALID_INPUT", `\`${name}\` must be a ${allowZero ? "non-negative" : "positive"} integer.`);
    }
    return value;
}

function requireAdmin(admin: DatabaseAdmin | undefined): SQLAdmin & BranchAdmin {
    if (!isSQLAdmin(admin) || !isBranchAdmin(admin)) {
        throw new BranchDiffError(
            "BRANCH_DIFF_UNSUPPORTED",
            "This data source cannot compare branches: it needs SQL and database branching (a Postgres backend with an admin connection)."
        );
    }
    return admin;
}

async function computeDiff(admin: DatabaseAdmin | undefined, branchName: string, options: BranchDiffOptions = {}): Promise<ComputedDiff> {
    const sql = requireAdmin(admin);
    const sampleLimit = positiveInteger(options.sampleLimit, DEFAULT_BRANCH_DIFF_SAMPLE_LIMIT, "sampleLimit", true);
    const maxRows = positiveInteger(options.maxRowsPerTable, DEFAULT_BRANCH_DIFF_MAX_ROWS, "maxRowsPerTable", false);
    const schemas = options.schemas && options.schemas.length > 0 ? [...new Set(options.schemas)].sort() : null;

    const branch = await sql.getBranchInfo(branchName);
    if (!branch) throw new BranchDiffError("BRANCH_NOT_FOUND", `Branch "${branchName}" not found.`);
    const branchDb = branch.database;
    const targetDb = branch.parentDatabase;

    const [targetCatalog, branchCatalog, fork] = await Promise.all([
        readCatalog(sql, targetDb, schemas),
        readCatalog(sql, branchDb, schemas),
        sql.executeSql("SELECT age(xmin)::text AS age FROM pg_database WHERE datname = $1", { database: targetDb, params: [branchDb] })
    ]);
    const forkAge = fork[0] ? Number(text(fork[0], "age")) : NaN;
    const forkPointKnown = Number.isFinite(forkAge) && forkAge < FROZEN_AGE;
    const forkDatabase = forkPointKnown ? branchDb : null;

    const schemaChanges = diffCatalogs(targetCatalog, branchCatalog);
    const data: BranchTableDataDiff[] = [];
    const matched = new Map<string, MatchedTable>();
    /** What the fingerprint covers, per table, beyond the schema. */
    const seen: Record<string, unknown>[] = [];

    // Tables on one side only: every row is the branch's insert or delete.
    const shared: { key: string; target: TableFacts; branch: TableFacts; compared: string[] }[] = [];
    for (const key of [...new Set([...targetCatalog.keys(), ...branchCatalog.keys()])].sort()) {
        const before = targetCatalog.get(key);
        const after = branchCatalog.get(key);
        if (before && after) {
            const types = new Map(before.columns.map((column) => [column.name, column.type]));
            const compared = after.columns
                .filter((column) => types.get(column.name) === column.type)
                .map((column) => column.name)
                .sort();
            shared.push({ key, target: before, branch: after, compared });
            continue;
        }
        const facts = after ?? before;
        if (!facts) continue;
        const database = after ? branchDb : targetDb;
        const count = await countRows(sql, database, facts);
        seen.push({ key, side: after ? "branch" : "target", count });
        if (count === 0) continue;
        const entry = emptyTableDiff(facts);
        const change = after ? "inserted" : "deleted";
        if (after) entry.inserted = count;
        else entry.deleted = count;
        entry.samples = (await firstRows(sql, database, facts, sampleLimit)).map(({ key: rowKey, row }) =>
            after ? { change, key: rowKey, after: row } : { change, key: rowKey, before: row });
        entry.blocked = after
            ? { code: "TABLE_ADDED", message: "The table is new on the branch. Create it on the target with your migrations (rebase db push), then merge its rows." }
            : { code: "TABLE_DROPPED", message: "The branch dropped the table. A merge never drops one; drop it with your migrations." };
        data.push(entry);
    }

    // Tables on both: a checksum each, and rows matched only where it differs.
    const probes = shared.map(({ target, compared }) => ({
        facts: target,
        keyExpr: target.primaryKey.length > 0 ? keyExpression(target.primaryKey) : "''",
        hashExpr: hashExpression(compared.length > 0 ? compared : target.columns.map((column) => column.name))
    }));
    const [targetSums, branchSums] = await Promise.all([
        checksums(sql, targetDb, probes),
        checksums(sql, branchDb, probes)
    ]);

    for (let index = 0; index < shared.length; index += 1) {
        const { key, target, branch: branchFacts, compared } = shared[index];
        const { keyExpr, hashExpr } = probes[index];
        const targetSum = targetSums[index];
        const branchSum = branchSums[index];
        if (targetSum.count === branchSum.count && targetSum.sum === branchSum.sum) continue;

        const entry = emptyTableDiff(branchFacts);
        const rowCounts = { target: targetSum.count, branch: branchSum.count };
        const typesOf = (facts: TableFacts) => facts.primaryKey.map((column) => facts.columns.find((c) => c.name === column)?.type ?? "");
        let block: BranchMergeBlock | undefined;
        if (!sameList(target.primaryKey, branchFacts.primaryKey) || !sameList(typesOf(target), typesOf(branchFacts))) {
            block = { code: "PRIMARY_KEY_DIFFERS", message: "The primary key differs between the branch and the target, so rows cannot be matched." };
        } else if (target.primaryKey.length === 0) {
            block = { code: "NO_PRIMARY_KEY", message: "The table has no primary key, so its rows cannot be matched one by one." };
        } else if (targetSum.count > maxRows || branchSum.count > maxRows) {
            block = { code: "TOO_LARGE", message: `The table holds more than ${maxRows} rows on one side, more than a diff matches row by row.` };
        }
        if (block) {
            entry.blocked = block;
            entry.rowCounts = rowCounts;
            if (branchSum.count > targetSum.count) entry.inserted = branchSum.count - targetSum.count;
            else entry.deleted = targetSum.count - branchSum.count;
            seen.push({ key, block: block.code, targetSum, branchSum });
            data.push(entry);
            continue;
        }

        const [targetRows, branchRows] = await Promise.all([
            rowStates(sql, targetDb, target, keyExpr, hashExpr, forkDatabase),
            rowStates(sql, branchDb, branchFacts, keyExpr, hashExpr, forkDatabase)
        ]);
        const rows = classifyRows(targetRows, branchRows, forkPointKnown);
        entry.inserted = rows.inserted.length;
        entry.updated = rows.updated.length;
        entry.deleted = rows.deleted.length;
        entry.conflicts = rows.conflicts.length;
        entry.targetChanges = rows.targetChanges;
        const branchChanged = entry.inserted + entry.updated + entry.deleted + entry.conflicts > 0;
        if (!branchChanged && entry.targetChanges === 0) continue;

        const columnsDiffer = target.columns.length !== compared.length || branchFacts.columns.length !== compared.length;
        if (branchChanged && columnsDiffer) {
            entry.blocked = {
                code: "COLUMNS_DIFFER",
                message: "The table's columns differ between the branch and the target. Rows are compared on the columns they share; " +
                    "apply the schema to the target with your migrations (rebase db push), then merge."
            };
        }

        const [conflictKeys, insertedKeys, updatedKeys, deletedKeys] = pickSamples(
            [rows.conflicts, rows.inserted, rows.updated, rows.deleted], sampleLimit);
        const [before, after] = await Promise.all([
            sampleRows(sql, targetDb, target, keyExpr, [...conflictKeys, ...updatedKeys, ...deletedKeys]),
            sampleRows(sql, branchDb, branchFacts, keyExpr, [...conflictKeys, ...insertedKeys, ...updatedKeys])
        ]);
        const changed = (rowKey: string): string[] => {
            const old = before.get(rowKey) ?? {};
            const now = after.get(rowKey) ?? {};
            return compared.filter((column) => old[column] !== now[column]);
        };
        const samples: BranchRowChange[] = [
            ...conflictKeys.map((rowKey): BranchRowChange => ({ change: "conflict", key: rowKey, before: before.get(rowKey), after: after.get(rowKey), changedColumns: changed(rowKey) })),
            ...insertedKeys.map((rowKey): BranchRowChange => ({ change: "inserted", key: rowKey, after: after.get(rowKey) })),
            ...updatedKeys.map((rowKey): BranchRowChange => ({ change: "updated", key: rowKey, before: before.get(rowKey), after: after.get(rowKey), changedColumns: changed(rowKey) })),
            ...deletedKeys.map((rowKey): BranchRowChange => ({ change: "deleted", key: rowKey, before: before.get(rowKey) }))
        ];
        entry.samples = samples;
        data.push(entry);

        const targetDigest = md5(targetRows.map((row) => `${row.key}:${row.hash}`).join(","));
        const stateDigest = (states: readonly RowState[]) => md5(states.map((row) => `${row.key}:${row.hash}:${row.young ? 1 : 0}`).join(","));
        seen.push({ key, target: stateDigest(targetRows), branch: stateDigest(branchRows) });
        matched.set(key, {
            facts: target,
            keyExpression: keyExpr,
            hashExpression: hashExpr,
            targetDigest,
            branchHashes: new Map(branchRows.map((row) => [row.key, row.hash])),
            rows
        });
    }

    const fingerprint = createHash("sha256")
        .update(JSON.stringify({ branchDb, targetDb, schemas, maxRows, forkPointKnown, schema: schemaChanges, tables: seen }), "utf8")
        .digest("hex");

    return {
        diff: {
            branch: branch.name,
            branchDatabase: branchDb,
            targetDatabase: targetDb,
            schemas: schemas ?? [...new Set([...targetCatalog.values(), ...branchCatalog.values()].map((facts) => facts.schema))].sort(),
            forkPointKnown,
            fingerprint,
            schema: schemaChanges,
            data,
            sampleLimit,
            computedAt: new Date().toISOString()
        },
        matched
    };
}

/**
 * What the branch `branchName` changed against the database it was made from:
 * its schema and policies, and per table the rows it inserted, updated and
 * deleted, with up to `sampleLimit` of them. Reads both databases and writes
 * neither.
 */
export async function diffDatabaseBranch(
    admin: DatabaseAdmin | undefined,
    branchName: string,
    options?: BranchDiffOptions
): Promise<BranchDiff> {
    return (await computeDiff(admin, branchName, options)).diff;
}

// ── Merge ────────────────────────────────────────────────────────────────────

/** The marker a merge statement's own refusal carries, to be told from any other failure. */
const MERGE_REFUSAL = "rebase branch merge refused";

/**
 * Apply the rows the branch `branchName` changed to the database it was made
 * from. See `BranchMergeOptions` for what wins and when nothing is written.
 */
export async function mergeDatabaseBranch(
    admin: DatabaseAdmin | undefined,
    branchName: string,
    options: BranchMergeOptions
): Promise<BranchMergeResult> {
    const sql = requireAdmin(admin);
    if (typeof options?.expectedFingerprint !== "string" || options.expectedFingerprint === "") {
        throw new BranchDiffError("INVALID_INPUT", "Send `expectedFingerprint`: the fingerprint of the diff that was reviewed.");
    }
    const onConflict = options.onConflict ?? "abort";
    if (onConflict !== "abort" && onConflict !== "branch" && onConflict !== "target") {
        throw new BranchDiffError("INVALID_INPUT", "`onConflict` must be \"abort\", \"branch\" or \"target\".");
    }

    const { diff, matched } = await computeDiff(admin, branchName, {
        sampleLimit: 0,
        schemas: options.schemas,
        maxRowsPerTable: options.maxRowsPerTable
    });
    if (diff.fingerprint !== options.expectedFingerprint) {
        throw new BranchDiffError(
            "BRANCH_DIFF_STALE",
            `The branch or ${diff.targetDatabase} changed since the diff was read. Nothing was merged; review the diff again.`
        );
    }

    const branchChanges = (entry: BranchTableDataDiff) => entry.inserted + entry.updated + entry.deleted + entry.conflicts;
    const blocked = diff.data.filter((entry) => entry.blocked && branchChanges(entry) > 0);
    if (blocked.length > 0 && options.skipBlocked !== true) {
        throw new BranchDiffError(
            "BRANCH_MERGE_BLOCKED",
            `${blocked.length} table(s) with changed rows cannot be merged. Nothing was merged.`,
            blocked.map((entry) => ({ schema: entry.schema, table: entry.table, reason: entry.blocked?.message ?? "" }))
        );
    }
    const conflicted = diff.data.filter((entry) => !entry.blocked && entry.conflicts > 0);
    if (conflicted.length > 0 && onConflict === "abort") {
        throw new BranchDiffError(
            "BRANCH_MERGE_CONFLICT",
            `${conflicted.reduce((sum, entry) => sum + entry.conflicts, 0)} row(s) were changed on both the branch and ${diff.targetDatabase}. ` +
            "Nothing was merged. Merge again choosing which side wins.",
            conflicted.map((entry) => ({ schema: entry.schema, table: entry.table, reason: `${entry.conflicts} conflicting row(s)` }))
        );
    }

    const result: BranchMergeResult = {
        branch: diff.branch,
        targetDatabase: diff.targetDatabase,
        tables: [],
        skipped: blocked.flatMap((entry) => entry.blocked ? [{ schema: entry.schema, table: entry.table, reason: entry.blocked }] : []),
        conflictsKept: onConflict === "target" ? conflicted.reduce((sum, entry) => sum + entry.conflicts, 0) : 0,
        schemaChangesNotMerged: diff.schema.length,
        warnings: []
    };

    // What to write, table by table, with the branch's rows read once more and
    // checked against the hashes the diff saw.
    const params: unknown[] = [];
    const param = (value: unknown): string => {
        params.push(value);
        return `$${params.length}`;
    };
    const guards: string[] = [];
    const writes: { name: string; sql: string; expected: number }[] = [];
    const written: { entry: BranchTableDataDiff; table: MatchedTable; inserted: number; updated: number; deleted: number }[] = [];

    for (const entry of diff.data) {
        if (entry.blocked) continue;
        const table = matched.get(tableKey(entry.schema, entry.table));
        if (!table) continue;
        const updates = onConflict === "branch" ? [...table.rows.updated, ...table.rows.conflicts] : table.rows.updated;
        const inserts = table.rows.inserted;
        const deletes = table.rows.deleted;
        if (updates.length + inserts.length + deletes.length === 0) continue;

        const branchRows = await sql.executeSql(
            `SELECT ${table.keyExpression} AS k, ${table.hashExpression} AS h, row_to_json(t)::text AS r
               FROM ${qualified(table.facts.schema, table.facts.table)} t
              WHERE ${table.keyExpression} = ANY($1::text[])`,
            { database: diff.branchDatabase, params: [[...updates, ...inserts]] }
        );
        const rowText = new Map<string, string>();
        for (const row of branchRows) {
            const rowKey = text(row, "k");
            if (table.branchHashes.get(rowKey) !== text(row, "h")) break;
            rowText.set(rowKey, text(row, "r"));
        }
        if (rowText.size !== updates.length + inserts.length) {
            throw new BranchDiffError("BRANCH_DIFF_STALE", "The branch changed while it was being merged. Nothing was merged; review the diff again.");
        }
        const rowsJson = (keys: readonly string[]) => `[${keys.map((rowKey) => rowText.get(rowKey)).join(",")}]`;

        const target = qualified(table.facts.schema, table.facts.table);
        const index = written.length;
        const writesBefore = writes.length;
        const writable = table.facts.columns.filter((column) => column.generated !== "s");
        const primaryKey = new Set(table.facts.primaryKey);
        const keyMatch = table.facts.primaryKey.map((column) => `t.${ident(column)} = r.${ident(column)}`).join(" AND ");
        if (deletes.length > 0) {
            writes.push({
                name: `d${index}`,
                sql: `DELETE FROM ${target} AS t WHERE (SELECT ok FROM guard) AND ${table.keyExpression} = ANY(${param([...deletes])}::text[]) RETURNING 1`,
                expected: deletes.length
            });
        }
        const settable = writable.filter((column) => !primaryKey.has(column.name) && column.identity !== "a");
        if (updates.length > 0 && settable.length > 0) {
            writes.push({
                name: `u${index}`,
                sql: `UPDATE ${target} AS t SET (${settable.map((column) => ident(column.name)).join(", ")}) = ` +
                    `ROW(${settable.map((column) => `r.${ident(column.name)}`).join(", ")}) ` +
                    `FROM json_populate_recordset(NULL::${target}, ${param(rowsJson(updates))}::json) AS r ` +
                    `WHERE (SELECT ok FROM guard) AND ${keyMatch} RETURNING 1`,
                expected: updates.length
            });
        }
        if (inserts.length > 0) {
            writes.push({
                name: `i${index}`,
                sql: `INSERT INTO ${target} (${writable.map((column) => ident(column.name)).join(", ")}) OVERRIDING SYSTEM VALUE ` +
                    `SELECT ${writable.map((column) => `r.${ident(column.name)}`).join(", ")} ` +
                    `FROM json_populate_recordset(NULL::${target}, ${param(rowsJson(inserts))}::json) AS r ` +
                    `WHERE (SELECT ok FROM guard) RETURNING 1`,
                expected: inserts.length
            });
        }
        if (writes.length === writesBefore) continue;
        guards.push(
            `(SELECT md5(coalesce(string_agg(${table.keyExpression} || ':' || ${table.hashExpression}, ',' ORDER BY (${table.keyExpression}) COLLATE "C"), '')) ` +
            `FROM ${target} t) = ${param(table.targetDigest)}`
        );
        written.push({ entry, table, inserted: inserts.length, updated: updates.length, deleted: deletes.length });
    }

    if (written.length === 0) return result;

    // One statement: the guard, every write, and a check that each wrote what
    // it was meant to. Non-deferrable foreign keys are checked at its end, so
    // the order of the tables does not matter; a failure anywhere — a
    // constraint, a trigger, a policy that hid a row — rolls back all of it.
    const counted = writes.map((write) => `(SELECT count(*) FROM ${write.name}) = ${write.expected}`).join(" AND ");
    const statement =
        `WITH guard AS (SELECT (${guards.join(" AND ")}) AS ok),\n` +
        writes.map((write) => `${write.name} AS (${write.sql})`).join(",\n") +
        `\nSELECT CASE WHEN NOT (SELECT ok FROM guard) THEN 'conflict'
                    WHEN ${counted || "true"} THEN 'merged'
                    ELSE CAST('${MERGE_REFUSAL}: a write did not reach the rows it read (' ||
                              ${writes.map((write) => `(SELECT count(*) FROM ${write.name})::text`).join(" || ',' || ") || "''"} || ')' AS integer)::text
               END AS outcome`;
    let outcome: string;
    try {
        const [row] = await sql.executeSql(statement, { database: diff.targetDatabase, params });
        outcome = row ? text(row, "outcome") : "";
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes(MERGE_REFUSAL)) {
            throw new BranchDiffError(
                "BRANCH_MERGE_CONFLICT",
                `${diff.targetDatabase} refused part of the merge — a row changed meanwhile, a trigger skipped it, or a policy hid it. Nothing was merged.`
            );
        }
        throw error;
    }
    if (outcome !== "merged") {
        throw new BranchDiffError(
            "BRANCH_MERGE_CONFLICT",
            `${diff.targetDatabase} changed while the merge was being prepared. Nothing was merged; review the diff again.`
        );
    }

    for (const { entry, table, inserted, updated, deleted } of written) {
        result.tables.push({ schema: entry.schema, table: entry.table, inserted, updated, deleted });
        if (inserted === 0) continue;
        // Rows inserted with their own ids leave the sequence behind them,
        // and the target's next insert would collide with one.
        for (const column of table.facts.columns) {
            if (!column.sequence) continue;
            try {
                await sql.executeSql(
                    `SELECT setval($1::regclass, m.mx)
                       FROM (SELECT max(${ident(column.name)})::bigint AS mx FROM ${qualified(entry.schema, entry.table)}) m
                      WHERE m.mx IS NOT NULL AND m.mx > coalesce(pg_sequence_last_value($1::regclass), 0)`,
                    { database: diff.targetDatabase, params: [column.sequence] }
                );
            } catch (error: unknown) {
                result.warnings.push(
                    `The rows were merged, but the sequence ${column.sequence} could not be advanced past them: ` +
                    `${error instanceof Error ? error.message : String(error)}. Run SELECT setval('${column.sequence}', ` +
                    `(SELECT max(${ident(column.name)}) FROM ${qualified(entry.schema, entry.table)})); on ${diff.targetDatabase}.`
                );
            }
        }
    }
    return result;
}
