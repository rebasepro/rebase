import type { SQLAdmin } from "@rebasepro/types";
import { isRecord, quoteIdent } from "./db-sql-guards";

/**
 * One table's catalog facts, read straight from `pg_catalog` for the Studio
 * table inspector: columns as Postgres spells their types, constraints,
 * foreign keys both ways, triggers, grants, storage and access statistics,
 * and the table's definition as SQL.
 *
 * Every value is shaped here into plain JSON (numbers, ISO strings, string
 * arrays), so a driver that returns `bigint` as text or `name[]` as a
 * Postgres array literal reads the same as one that parses them.
 */

export interface CatalogColumn {
    name: string;
    /** `format_type()` — the type as Postgres prints it, modifiers included (`character varying(255)`). */
    type: string;
    /** `pg_type.typname` — `int4`, `jsonb`, `_text` for an array. */
    udt: string;
    /** `pg_type.typcategory` — `A` array, `B` boolean, `D` date/time, `N` numeric, `S` string, `U` user-defined… */
    category: string;
    notNull: boolean;
    default: string | null;
    /** `always` / `by_default` for an identity column. */
    identity: "always" | "by_default" | null;
    /** `stored` / `virtual` for a generated column; `default` then holds its expression. */
    generated: "stored" | "virtual" | null;
    primaryKey: boolean;
    comment: string | null;
}

export interface CatalogConstraint {
    name: string;
    kind: "primary_key" | "unique" | "check" | "foreign_key" | "exclusion" | "other";
    definition: string;
    columns: string[];
}

export interface CatalogForeignKey {
    name: string;
    definition: string;
    fromSchema: string;
    fromTable: string;
    fromColumns: string[];
    toSchema: string;
    toTable: string;
    toColumns: string[];
    onDelete: string;
    onUpdate: string;
}

export interface CatalogTrigger {
    name: string;
    enabled: boolean;
    definition: string;
    functionSchema: string;
    functionName: string;
}

export interface CatalogGrant {
    grantee: string;
    grantor: string;
    privilege: string;
    grantable: boolean;
}

export interface CatalogPolicy {
    name: string;
    mode: "permissive" | "restrictive";
    command: string;
    roles: string[];
    using: string | null;
    withCheck: string | null;
}

export interface CatalogIndex {
    name: string;
    definition: string;
    method: string;
    unique: boolean;
    primary: boolean;
    valid: boolean;
    backsConstraint: boolean;
    bytes: number | null;
    scans: number | null;
    tuplesRead: number | null;
    tuplesFetched: number | null;
}

export interface CatalogTableStats {
    totalBytes: number | null;
    tableBytes: number | null;
    indexBytes: number | null;
    toastBytes: number | null;
    rowEstimate: number | null;
    liveTuples: number | null;
    deadTuples: number | null;
    seqScans: number | null;
    seqTuplesRead: number | null;
    indexScans: number | null;
    indexTuplesFetched: number | null;
    inserts: number | null;
    updates: number | null;
    deletes: number | null;
    lastVacuum: string | null;
    lastAutovacuum: string | null;
    lastAnalyze: string | null;
    lastAutoanalyze: string | null;
}

export type RelationKind = "table" | "partitioned_table" | "view" | "materialized_view" | "foreign_table";

export interface CatalogRelation {
    schema: string;
    name: string;
    kind: RelationKind;
    owner: string;
    rlsEnabled: boolean;
    rlsForced: boolean;
    comment: string | null;
    /** `true` when `relacl` is NULL: the owner holds every privilege and nobody else holds any. */
    defaultPrivileges: boolean;
}

export interface TableDetails {
    relation: CatalogRelation;
    columns: CatalogColumn[];
    constraints: CatalogConstraint[];
    foreignKeys: { outgoing: CatalogForeignKey[]; incoming: CatalogForeignKey[] };
    triggers: CatalogTrigger[];
    grants: CatalogGrant[];
    policies: CatalogPolicy[];
    indexes: CatalogIndex[];
    stats: CatalogTableStats | null;
    /** `pg_get_viewdef` for a view or materialized view. */
    viewDefinition: string | null;
    ddl: string;
}

// ── value shaping ──────────────────────────────────────────────────────────

const text = (value: unknown): string => (value === null || value === undefined ? "" : String(value));
const textOrNull = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));

function numberOrNull(value: unknown): number | null {
    if (value === null || value === undefined || value === "") return null;
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : null;
}

function isoOrNull(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
    return String(value);
}

/** A list column read through `to_json(...)`; tolerates a driver that hands back the JSON text. */
function stringList(value: unknown): string[] {
    let parsed: unknown = value;
    if (typeof value === "string") {
        try {
            parsed = JSON.parse(value);
        } catch {
            return value.replace(/^\{|\}$/g, "").split(",").filter(Boolean);
        }
    }
    return Array.isArray(parsed) ? parsed.map(item => String(item)) : [];
}

const RELKINDS: Record<string, RelationKind> = {
    r: "table",
    p: "partitioned_table",
    v: "view",
    m: "materialized_view",
    f: "foreign_table"
};

const CONSTRAINT_KINDS: Record<string, CatalogConstraint["kind"]> = {
    p: "primary_key",
    u: "unique",
    c: "check",
    f: "foreign_key",
    x: "exclusion"
};

const FK_ACTIONS: Record<string, string> = {
    a: "NO ACTION",
    r: "RESTRICT",
    c: "CASCADE",
    n: "SET NULL",
    d: "SET DEFAULT"
};

/** `"schema"."table"`, the text a `$1::regclass` parameter takes. */
export function relationRef(schema: string, table: string): string {
    return `${quoteIdent(schema)}.${quoteIdent(table)}`;
}

export function quoteLiteral(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

// ── queries ────────────────────────────────────────────────────────────────

const COLUMNS_SQL = `
    SELECT a.attname AS name,
           format_type(a.atttypid, a.atttypmod) AS type,
           t.typname AS udt,
           t.typcategory AS category,
           a.attnotnull AS not_null,
           pg_get_expr(d.adbin, d.adrelid) AS default_expr,
           a.attidentity AS identity,
           a.attgenerated AS generated,
           col_description(a.attrelid, a.attnum) AS comment,
           COALESCE((SELECT true FROM pg_index ix
                      WHERE ix.indrelid = a.attrelid AND ix.indisprimary
                        AND a.attnum = ANY(ix.indkey::int2[])), false) AS is_pk
      FROM pg_attribute a
      JOIN pg_type t ON t.oid = a.atttypid
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY a.attnum`;

const RELATION_SQL = `
    SELECT n.nspname AS schema_name, c.relname AS name, c.relkind AS relkind,
           pg_get_userbyid(c.relowner) AS owner,
           c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced,
           obj_description(c.oid, 'pg_class') AS comment,
           (c.relacl IS NULL) AS default_privileges
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.oid = $1::regclass`;

const CONSTRAINTS_SQL = `
    SELECT con.conname AS name, con.contype AS kind,
           pg_get_constraintdef(con.oid, true) AS definition,
           to_json(ARRAY(SELECT a.attname
                           FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
                           JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
                          ORDER BY k.ord)) AS columns
      FROM pg_constraint con
     WHERE con.conrelid = $1::regclass
     ORDER BY CASE con.contype WHEN 'p' THEN 0 WHEN 'u' THEN 1 WHEN 'f' THEN 2 WHEN 'c' THEN 3 ELSE 4 END, con.conname`;

/** Foreign keys, filtered by the caller's WHERE on `con`, `src_ns`, `src`. */
const FOREIGN_KEYS_SELECT = `
    SELECT con.conname AS name,
           pg_get_constraintdef(con.oid, true) AS definition,
           src_ns.nspname AS from_schema, src.relname AS from_table,
           to_json(ARRAY(SELECT a.attname
                           FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
                           JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
                          ORDER BY k.ord)) AS from_columns,
           tgt_ns.nspname AS to_schema, tgt.relname AS to_table,
           to_json(ARRAY(SELECT a.attname
                           FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
                           JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum
                          ORDER BY k.ord)) AS to_columns,
           con.confdeltype AS on_delete, con.confupdtype AS on_update
      FROM pg_constraint con
      JOIN pg_class src ON src.oid = con.conrelid
      JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
      JOIN pg_class tgt ON tgt.oid = con.confrelid
      JOIN pg_namespace tgt_ns ON tgt_ns.oid = tgt.relnamespace
     WHERE con.contype = 'f'`;

const TRIGGERS_SQL = `
    SELECT t.tgname AS name, t.tgenabled AS enabled,
           pg_get_triggerdef(t.oid, true) AS definition,
           pn.nspname AS function_schema, p.proname AS function_name
      FROM pg_trigger t
      JOIN pg_proc p ON p.oid = t.tgfoid
      JOIN pg_namespace pn ON pn.oid = p.pronamespace
     WHERE t.tgrelid = $1::regclass AND NOT t.tgisinternal
     ORDER BY t.tgname`;

const GRANTS_SQL = `
    SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
           pg_get_userbyid(a.grantor) AS grantor,
           a.privilege_type AS privilege,
           a.is_grantable AS grantable
      FROM pg_class c, aclexplode(c.relacl) AS a
     WHERE c.oid = $1::regclass
     ORDER BY 1, 3`;

const POLICIES_SQL = `
    SELECT policyname AS name, permissive, cmd AS command,
           to_json(roles) AS roles, qual AS using_expr, with_check AS with_check_expr
      FROM pg_policies
     WHERE schemaname = $1 AND tablename = $2
     ORDER BY policyname`;

const INDEXES_SQL = `
    SELECT i.relname AS name,
           pg_get_indexdef(ix.indexrelid) AS definition,
           am.amname AS method,
           ix.indisunique AS is_unique, ix.indisprimary AS is_primary, ix.indisvalid AS is_valid,
           EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = ix.indexrelid AND con.conrelid = ix.indrelid) AS backs_constraint,
           pg_relation_size(ix.indexrelid) AS bytes
      FROM pg_index ix
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_am am ON am.oid = i.relam
     WHERE ix.indrelid = $1::regclass
     ORDER BY i.relname`;

const INDEX_USAGE_SQL = `
    SELECT indexrelname AS name, idx_scan, idx_tup_read, idx_tup_fetch
      FROM pg_stat_user_indexes
     WHERE relid = $1::regclass`;

const STATS_SQL = `
    SELECT pg_total_relation_size(c.oid) AS total_bytes,
           pg_relation_size(c.oid) AS table_bytes,
           pg_indexes_size(c.oid) AS index_bytes,
           c.reltuples AS reltuples,
           s.n_live_tup, s.n_dead_tup, s.seq_scan, s.seq_tup_read, s.idx_scan, s.idx_tup_fetch,
           s.n_tup_ins, s.n_tup_upd, s.n_tup_del,
           s.last_vacuum, s.last_autovacuum, s.last_analyze, s.last_autoanalyze
      FROM pg_class c
      LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
     WHERE c.oid = $1::regclass`;

function shapeForeignKey(row: Record<string, unknown>): CatalogForeignKey {
    return {
        name: text(row.name),
        definition: text(row.definition),
        fromSchema: text(row.from_schema),
        fromTable: text(row.from_table),
        fromColumns: stringList(row.from_columns),
        toSchema: text(row.to_schema),
        toTable: text(row.to_table),
        toColumns: stringList(row.to_columns),
        onDelete: FK_ACTIONS[text(row.on_delete)] ?? "NO ACTION",
        onUpdate: FK_ACTIONS[text(row.on_update)] ?? "NO ACTION"
    };
}

/** Columns of one relation, with the metadata a row editor needs to cast text back to the column's type. */
export async function readCatalogColumns(admin: SQLAdmin, schema: string, table: string): Promise<CatalogColumn[]> {
    const rows = await admin.executeSql(COLUMNS_SQL, { params: [relationRef(schema, table)] });
    return rows.map(row => ({
        name: text(row.name),
        type: text(row.type),
        udt: text(row.udt),
        category: text(row.category),
        notNull: row.not_null === true,
        default: textOrNull(row.default_expr),
        identity: row.identity === "a" ? "always" : row.identity === "d" ? "by_default" : null,
        generated: row.generated === "s" ? "stored" : row.generated === "v" ? "virtual" : null,
        primaryKey: row.is_pk === true,
        comment: textOrNull(row.comment)
    }));
}

export async function readCatalogRelation(admin: SQLAdmin, schema: string, table: string): Promise<CatalogRelation | null> {
    const rows = await admin.executeSql(
        `SELECT to_regclass($1) IS NOT NULL AS present`,
        { params: [relationRef(schema, table)] }
    );
    if (rows[0]?.present !== true) return null;
    const [row] = await admin.executeSql(RELATION_SQL, { params: [relationRef(schema, table)] });
    if (!row) return null;
    return {
        schema: text(row.schema_name),
        name: text(row.name),
        kind: RELKINDS[text(row.relkind)] ?? "table",
        owner: text(row.owner),
        rlsEnabled: row.rls_enabled === true,
        rlsForced: row.rls_forced === true,
        comment: textOrNull(row.comment),
        defaultPrivileges: row.default_privileges === true
    };
}

/** Every foreign key declared on a table of `schema`, keyed by that table. */
export async function readSchemaForeignKeys(admin: SQLAdmin, schema: string): Promise<Map<string, CatalogForeignKey[]>> {
    const rows = await admin.executeSql(
        `${FOREIGN_KEYS_SELECT} AND src_ns.nspname = $1 ORDER BY src.relname, con.conname`,
        { params: [schema] }
    );
    const byTable = new Map<string, CatalogForeignKey[]>();
    for (const row of rows) {
        const fk = shapeForeignKey(row);
        const list = byTable.get(fk.fromTable) ?? [];
        list.push(fk);
        byTable.set(fk.fromTable, list);
    }
    return byTable;
}

/** `GREATEST(reltuples, n_live_tup)` per table of `schema`: never-analyzed tables read -1 in `reltuples`. */
export async function readSchemaRowEstimates(admin: SQLAdmin, schema: string): Promise<Map<string, number>> {
    const estimates = new Map<string, number>();
    try {
        const rows = await admin.executeSql(
            `SELECT c.relname AS name, GREATEST(c.reltuples, COALESCE(s.n_live_tup, 0), 0)::bigint AS estimate
               FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
               LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
              WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'm')`,
            { params: [schema] }
        );
        for (const row of rows) {
            const estimate = numberOrNull(row.estimate);
            if (estimate !== null) estimates.set(text(row.name), estimate);
        }
    } catch {
        // Statistics views are optional: an estimate is a nicety, never a reason to fail the listing.
    }
    return estimates;
}

async function readOptional<T>(read: () => Promise<T>, fallback: T): Promise<T> {
    try {
        return await read();
    } catch {
        return fallback;
    }
}

export async function readTableDetails(admin: SQLAdmin, schema: string, table: string): Promise<TableDetails | null> {
    const relation = await readCatalogRelation(admin, schema, table);
    if (!relation) return null;
    const ref = relationRef(schema, table);
    const isView = relation.kind === "view" || relation.kind === "materialized_view";

    const [columns, constraintRows, fkRows, triggerRows, grantRows, policyRows, indexRows] = await Promise.all([
        readCatalogColumns(admin, schema, table),
        admin.executeSql(CONSTRAINTS_SQL, { params: [ref] }),
        admin.executeSql(
            `${FOREIGN_KEYS_SELECT} AND (con.conrelid = $1::regclass OR con.confrelid = $1::regclass) ORDER BY con.conname`,
            { params: [ref] }
        ),
        admin.executeSql(TRIGGERS_SQL, { params: [ref] }),
        admin.executeSql(GRANTS_SQL, { params: [ref] }),
        admin.executeSql(POLICIES_SQL, { params: [schema, table] }),
        admin.executeSql(INDEXES_SQL, { params: [ref] })
    ]);

    const usageRows = await readOptional(() => admin.executeSql(INDEX_USAGE_SQL, { params: [ref] }), []);
    const usageByIndex = new Map(usageRows.map(row => [text(row.name), row]));
    const statsRow = await readOptional(async () => (await admin.executeSql(STATS_SQL, { params: [ref] }))[0] ?? null, null);
    const viewDefinition = isView
        ? await readOptional(async () => {
            const [row] = await admin.executeSql(`SELECT pg_get_viewdef($1::regclass, true) AS definition`, { params: [ref] });
            return textOrNull(row?.definition);
        }, null)
        : null;

    const constraints: CatalogConstraint[] = constraintRows.map(row => ({
        name: text(row.name),
        kind: CONSTRAINT_KINDS[text(row.kind)] ?? "other",
        definition: text(row.definition),
        columns: stringList(row.columns)
    }));

    const outgoing: CatalogForeignKey[] = [];
    const incoming: CatalogForeignKey[] = [];
    for (const row of fkRows) {
        const fk = shapeForeignKey(row);
        if (fk.fromSchema === schema && fk.fromTable === table) outgoing.push(fk);
        if (fk.toSchema === schema && fk.toTable === table) incoming.push(fk);
    }

    const triggers: CatalogTrigger[] = triggerRows.map(row => ({
        name: text(row.name),
        enabled: text(row.enabled) !== "D",
        definition: text(row.definition),
        functionSchema: text(row.function_schema),
        functionName: text(row.function_name)
    }));

    const grants: CatalogGrant[] = grantRows.map(row => ({
        grantee: text(row.grantee),
        grantor: text(row.grantor),
        privilege: text(row.privilege),
        grantable: row.grantable === true
    }));

    const policies: CatalogPolicy[] = policyRows.map(row => ({
        name: text(row.name),
        mode: row.permissive === "RESTRICTIVE" ? "restrictive" : "permissive",
        command: text(row.command),
        roles: stringList(row.roles),
        using: textOrNull(row.using_expr),
        withCheck: textOrNull(row.with_check_expr)
    }));

    const indexes: CatalogIndex[] = indexRows.map(row => {
        const usage = usageByIndex.get(text(row.name));
        return {
            name: text(row.name),
            definition: text(row.definition),
            method: text(row.method),
            unique: row.is_unique === true,
            primary: row.is_primary === true,
            valid: row.is_valid !== false,
            backsConstraint: row.backs_constraint === true,
            bytes: numberOrNull(row.bytes),
            scans: usage ? numberOrNull(usage.idx_scan) : null,
            tuplesRead: usage ? numberOrNull(usage.idx_tup_read) : null,
            tuplesFetched: usage ? numberOrNull(usage.idx_tup_fetch) : null
        };
    });

    const stats = statsRow && isRecord(statsRow) ? shapeStats(statsRow) : null;

    const details: Omit<TableDetails, "ddl"> = {
        relation,
        columns,
        constraints,
        foreignKeys: { outgoing, incoming },
        triggers,
        grants,
        policies,
        indexes,
        stats,
        viewDefinition
    };
    return { ...details, ddl: renderTableDdl(details) };
}

function shapeStats(row: Record<string, unknown>): CatalogTableStats {
    const total = numberOrNull(row.total_bytes);
    const tableBytes = numberOrNull(row.table_bytes);
    const indexBytes = numberOrNull(row.index_bytes);
    const reltuples = numberOrNull(row.reltuples);
    const live = numberOrNull(row.n_live_tup);
    const estimate = Math.max(reltuples ?? -1, live ?? -1);
    return {
        totalBytes: total,
        tableBytes,
        indexBytes,
        toastBytes: total !== null && tableBytes !== null && indexBytes !== null
            ? Math.max(0, total - tableBytes - indexBytes)
            : null,
        rowEstimate: estimate >= 0 ? Math.round(estimate) : null,
        liveTuples: live,
        deadTuples: numberOrNull(row.n_dead_tup),
        seqScans: numberOrNull(row.seq_scan),
        seqTuplesRead: numberOrNull(row.seq_tup_read),
        indexScans: numberOrNull(row.idx_scan),
        indexTuplesFetched: numberOrNull(row.idx_tup_fetch),
        inserts: numberOrNull(row.n_tup_ins),
        updates: numberOrNull(row.n_tup_upd),
        deletes: numberOrNull(row.n_tup_del),
        lastVacuum: isoOrNull(row.last_vacuum),
        lastAutovacuum: isoOrNull(row.last_autovacuum),
        lastAnalyze: isoOrNull(row.last_analyze),
        lastAutoanalyze: isoOrNull(row.last_autoanalyze)
    };
}

// ── definition as SQL ──────────────────────────────────────────────────────

function renderRoleList(roles: readonly string[]): string {
    if (roles.length === 0) return "PUBLIC";
    return roles.map(role => (role.toLowerCase() === "public" ? "PUBLIC" : quoteIdent(role))).join(", ");
}

function renderPolicy(target: string, policy: CatalogPolicy): string {
    const parts = [
        `CREATE POLICY ${quoteIdent(policy.name)} ON ${target}`,
        `    AS ${policy.mode === "restrictive" ? "RESTRICTIVE" : "PERMISSIVE"}`,
        `    FOR ${policy.command || "ALL"}`,
        `    TO ${renderRoleList(policy.roles)}`
    ];
    if (policy.using) parts.push(`    USING (${policy.using})`);
    if (policy.withCheck) parts.push(`    WITH CHECK (${policy.withCheck})`);
    return `${parts.join("\n")};`;
}

function renderColumnLine(column: CatalogColumn): string {
    const parts = [`    ${quoteIdent(column.name)} ${column.type}`];
    if (column.generated && column.default) {
        parts.push(`GENERATED ALWAYS AS (${column.default}) ${column.generated === "virtual" ? "VIRTUAL" : "STORED"}`);
    } else if (column.identity) {
        parts.push(`GENERATED ${column.identity === "always" ? "ALWAYS" : "BY DEFAULT"} AS IDENTITY`);
    } else if (column.default !== null) {
        parts.push(`DEFAULT ${column.default}`);
    }
    if (column.notNull) parts.push("NOT NULL");
    return parts.join(" ");
}

/**
 * The relation's definition as one SQL script, in the order `pg_dump` would
 * replay it: the table with its own constraints, then foreign keys, indexes
 * that back no constraint, row level security and policies, triggers,
 * comments and grants.
 */
export function renderTableDdl(details: Omit<TableDetails, "ddl">): string {
    const { relation, columns } = details;
    const target = relationRef(relation.schema, relation.name);
    const out: string[] = [];

    if (relation.kind === "view" || relation.kind === "materialized_view") {
        const keyword = relation.kind === "view" ? "VIEW" : "MATERIALIZED VIEW";
        out.push(`CREATE ${keyword} ${target} AS\n${(details.viewDefinition ?? "").trim().replace(/;$/, "")};`);
    } else {
        const lines = columns.map(renderColumnLine);
        for (const constraint of details.constraints) {
            if (constraint.kind === "foreign_key") continue;
            lines.push(`    CONSTRAINT ${quoteIdent(constraint.name)} ${constraint.definition}`);
        }
        out.push(`CREATE TABLE ${target} (\n${lines.join(",\n")}\n);`);
        for (const fk of details.foreignKeys.outgoing) {
            out.push(`ALTER TABLE ${target}\n    ADD CONSTRAINT ${quoteIdent(fk.name)} ${fk.definition};`);
        }
    }

    const looseIndexes = details.indexes.filter(index => !index.backsConstraint);
    if (looseIndexes.length > 0) out.push(looseIndexes.map(index => `${index.definition};`).join("\n"));

    if (relation.rlsEnabled) out.push(`ALTER TABLE ${target} ENABLE ROW LEVEL SECURITY;`);
    if (relation.rlsForced) out.push(`ALTER TABLE ${target} FORCE ROW LEVEL SECURITY;`);
    for (const policy of details.policies) out.push(renderPolicy(target, policy));

    if (details.triggers.length > 0) {
        out.push(details.triggers.map(trigger => `${trigger.definition};`).join("\n"));
        const disabled = details.triggers.filter(trigger => !trigger.enabled);
        for (const trigger of disabled) out.push(`ALTER TABLE ${target} DISABLE TRIGGER ${quoteIdent(trigger.name)};`);
    }

    const comments: string[] = [];
    if (relation.comment) {
        const keyword = relation.kind === "view" ? "VIEW" : relation.kind === "materialized_view" ? "MATERIALIZED VIEW" : "TABLE";
        comments.push(`COMMENT ON ${keyword} ${target} IS ${quoteLiteral(relation.comment)};`);
    }
    for (const column of columns) {
        if (column.comment) comments.push(`COMMENT ON COLUMN ${target}.${quoteIdent(column.name)} IS ${quoteLiteral(column.comment)};`);
    }
    if (comments.length > 0) out.push(comments.join("\n"));

    const grants = renderGrants(target, relation.owner, details.grants);
    if (grants) out.push(grants);

    return `${out.join("\n\n")}\n`;
}

function renderGrants(target: string, owner: string, grants: readonly CatalogGrant[]): string {
    const byGrantee = new Map<string, { plain: string[]; grantable: string[] }>();
    for (const grant of grants) {
        if (grant.grantee === owner) continue;
        const entry = byGrantee.get(grant.grantee) ?? { plain: [], grantable: [] };
        (grant.grantable ? entry.grantable : entry.plain).push(grant.privilege);
        byGrantee.set(grant.grantee, entry);
    }
    const lines: string[] = [];
    for (const [grantee, entry] of byGrantee) {
        const role = grantee === "PUBLIC" ? "PUBLIC" : quoteIdent(grantee);
        if (entry.plain.length > 0) lines.push(`GRANT ${entry.plain.join(", ")} ON ${target} TO ${role};`);
        if (entry.grantable.length > 0) lines.push(`GRANT ${entry.grantable.join(", ")} ON ${target} TO ${role} WITH GRANT OPTION;`);
    }
    return lines.join("\n");
}
