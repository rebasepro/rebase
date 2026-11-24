import type { PostgresPolicy } from "@rebasepro/types";
import { asBoolean, asNullableString, asNumber, asString, asStringArray, isRecord } from "../../utils/adminFetch";

/**
 * What the table inspector reads from `/api/admin/db`: the table list (one
 * call for every table of a schema) and one table's catalog details. Parsed
 * defensively, so a server one version behind never draws `undefined`.
 */

export interface DbColumnInfo {
    name: string;
    /** The column's name on the wire (`/api/data`), which may be camelCased. */
    key: string;
    dataType: string;
    udtName: string;
    nullable: boolean;
    defaultExpr: string | null;
    primaryKey: boolean;
    unique: boolean;
}

export interface DbPolicyInfo {
    name: string;
    mode: "permissive" | "restrictive";
    operation: string;
    roles: string[];
    using: string | null;
    withCheck: string | null;
}

export interface DbIndexInfo {
    name: string;
    definition: string;
    unique: boolean;
    primary: boolean;
}

export interface DbForeignKey {
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

export interface DbTableMeta {
    slug: string | null;
    exposed: boolean;
    description: string | null;
    softDelete: boolean;
    softDeleteColumn: string | null;
    history: boolean;
    readOnly: boolean;
}

export interface DbTableInfo {
    schema: string;
    name: string;
    /** `schema.name` — the one identity every Studio view uses for a table. */
    key: string;
    slug: string;
    kind: "table" | "view";
    materialized: boolean;
    rlsEnabled: boolean;
    rlsForced: boolean;
    exposed: boolean;
    served: boolean;
    comment: string | null;
    rowEstimate: number | null;
    columns: DbColumnInfo[];
    policies: DbPolicyInfo[];
    indexes: DbIndexInfo[];
    foreignKeys: DbForeignKey[];
    meta: DbTableMeta | null;
}

export function tableKey(schema: string, name: string): string {
    return `${schema}.${name}`;
}

function parseColumn(raw: unknown): DbColumnInfo | null {
    if (!isRecord(raw) || typeof raw.name !== "string") return null;
    return {
        name: raw.name,
        key: asString(raw.key, raw.name),
        dataType: asString(raw.dataType, "text"),
        udtName: asString(raw.udtName, "text"),
        nullable: asBoolean(raw.nullable, true),
        defaultExpr: asNullableString(raw.default ?? raw.defaultExpr),
        primaryKey: asBoolean(raw.primaryKey, false),
        unique: asBoolean(raw.unique, false)
    };
}

function parsePolicy(raw: unknown): DbPolicyInfo | null {
    if (!isRecord(raw) || typeof raw.name !== "string") return null;
    return {
        name: raw.name,
        mode: raw.mode === "restrictive" ? "restrictive" : "permissive",
        operation: asString(raw.operation ?? raw.command, "ALL"),
        roles: asStringArray(raw.roles),
        using: asNullableString(raw.using),
        withCheck: asNullableString(raw.withCheck)
    };
}

function parseIndex(raw: unknown): DbIndexInfo | null {
    if (!isRecord(raw) || typeof raw.name !== "string") return null;
    return {
        name: raw.name,
        definition: asString(raw.definition, ""),
        unique: asBoolean(raw.unique, false),
        primary: asBoolean(raw.primary, false)
    };
}

export function parseForeignKey(raw: unknown): DbForeignKey | null {
    if (!isRecord(raw) || typeof raw.name !== "string") return null;
    return {
        name: raw.name,
        definition: asString(raw.definition, ""),
        fromSchema: asString(raw.fromSchema, "public"),
        fromTable: asString(raw.fromTable, ""),
        fromColumns: asStringArray(raw.fromColumns),
        toSchema: asString(raw.toSchema, "public"),
        toTable: asString(raw.toTable, ""),
        toColumns: asStringArray(raw.toColumns),
        onDelete: asString(raw.onDelete, "NO ACTION"),
        onUpdate: asString(raw.onUpdate, "NO ACTION")
    };
}

function parseMeta(raw: unknown): DbTableMeta | null {
    if (!isRecord(raw)) return null;
    const softDeleteColumn = asNullableString(raw.softDeleteColumn ?? raw.soft_delete_column);
    const readonlyColumns = asStringArray(raw.readonlyColumns ?? raw.readonly_columns);
    return {
        slug: asNullableString(raw.slug),
        exposed: asBoolean(raw.exposed, true),
        description: asNullableString(raw.description),
        softDelete: Boolean(softDeleteColumn) || asBoolean(raw.softDelete, false),
        softDeleteColumn,
        history: asBoolean(raw.historyEnabled ?? raw.history_enabled ?? raw.history, false),
        readOnly: readonlyColumns.length > 0 || asBoolean(raw.readOnly, false)
    };
}

function listOf<T>(raw: unknown, parse: (value: unknown) => T | null): T[] {
    return Array.isArray(raw) ? raw.map(parse).filter((value): value is T => value !== null) : [];
}

function parseTable(raw: unknown): DbTableInfo | null {
    if (!isRecord(raw) || typeof raw.name !== "string") return null;
    const schema = asString(raw.schema, "public");
    const estimate = raw.rowEstimate;
    return {
        schema,
        name: raw.name,
        key: tableKey(schema, raw.name),
        slug: asString(raw.slug, raw.name),
        kind: raw.kind === "view" ? "view" : "table",
        materialized: asBoolean(raw.materialized, false),
        rlsEnabled: asBoolean(raw.rlsEnabled, false),
        rlsForced: asBoolean(raw.rlsForced, false),
        exposed: asBoolean(raw.exposed, true),
        served: asBoolean(raw.served, false),
        comment: asNullableString(raw.comment),
        rowEstimate: typeof estimate === "number" ? estimate : null,
        columns: listOf(raw.columns, parseColumn),
        policies: listOf(raw.policies, parsePolicy),
        indexes: listOf(raw.indexes, parseIndex),
        foreignKeys: listOf(raw.foreignKeys, parseForeignKey),
        meta: parseMeta(raw.meta)
    };
}

export function parseTablesResponse(raw: unknown): DbTableInfo[] {
    if (!isRecord(raw) || !Array.isArray(raw.tables)) return [];
    return listOf(raw.tables, parseTable);
}

/** A table's live policies in the shape the RLS editor compares against declarations. */
export function asPostgresPolicies(table: DbTableInfo): PostgresPolicy[] {
    return table.policies.map(policy => ({
        policyname: policy.name,
        tablename: table.name,
        permissive: policy.mode === "restrictive" ? "RESTRICTIVE" : "PERMISSIVE",
        roles: policy.roles,
        cmd: (["SELECT", "INSERT", "UPDATE", "DELETE", "ALL"] as const).find(cmd => cmd === policy.operation.toUpperCase()) ?? "ALL",
        qual: policy.using,
        with_check: policy.withCheck
    }));
}

/**
 * Why a table is not on `/api/data`, from what the server reported about it —
 * the one reason that holds. The translation key of the sentence.
 */
export function notServedReasonKey(table: DbTableInfo): string {
    if (!table.rlsEnabled) return "studio_tables_not_served_rls_off";
    if (!(table.meta?.exposed ?? table.exposed)) return "studio_tables_not_served_not_exposed";
    return "studio_tables_not_served_not_picked_up";
}

// ── one table's catalog details (`GET /tables/:t/details`) ─────────────────

export interface CatalogColumn {
    name: string;
    type: string;
    udt: string;
    category: string;
    notNull: boolean;
    default: string | null;
    identity: "always" | "by_default" | null;
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

export interface TableDetails {
    relation: {
        schema: string;
        name: string;
        kind: "table" | "partitioned_table" | "view" | "materialized_view" | "foreign_table";
        owner: string;
        rlsEnabled: boolean;
        rlsForced: boolean;
        comment: string | null;
        defaultPrivileges: boolean;
    };
    columns: CatalogColumn[];
    constraints: CatalogConstraint[];
    foreignKeys: { outgoing: DbForeignKey[]; incoming: DbForeignKey[] };
    triggers: CatalogTrigger[];
    grants: CatalogGrant[];
    indexes: CatalogIndex[];
    stats: CatalogTableStats | null;
    ddl: string;
}

const numberOrNull = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

function parseCatalogColumn(raw: unknown): CatalogColumn | null {
    if (!isRecord(raw) || typeof raw.name !== "string") return null;
    return {
        name: raw.name,
        type: asString(raw.type, "text"),
        udt: asString(raw.udt, "text"),
        category: asString(raw.category, "S"),
        notNull: asBoolean(raw.notNull, false),
        default: asNullableString(raw.default),
        identity: raw.identity === "always" || raw.identity === "by_default" ? raw.identity : null,
        generated: raw.generated === "stored" || raw.generated === "virtual" ? raw.generated : null,
        primaryKey: asBoolean(raw.primaryKey, false),
        comment: asNullableString(raw.comment)
    };
}

const CONSTRAINT_KINDS = ["primary_key", "unique", "check", "foreign_key", "exclusion", "other"] as const;

function parseConstraint(raw: unknown): CatalogConstraint | null {
    if (!isRecord(raw) || typeof raw.name !== "string") return null;
    return {
        name: raw.name,
        kind: CONSTRAINT_KINDS.find(kind => kind === raw.kind) ?? "other",
        definition: asString(raw.definition, ""),
        columns: asStringArray(raw.columns)
    };
}

function parseTrigger(raw: unknown): CatalogTrigger | null {
    if (!isRecord(raw) || typeof raw.name !== "string") return null;
    return {
        name: raw.name,
        enabled: asBoolean(raw.enabled, true),
        definition: asString(raw.definition, ""),
        functionSchema: asString(raw.functionSchema, ""),
        functionName: asString(raw.functionName, "")
    };
}

function parseGrant(raw: unknown): CatalogGrant | null {
    if (!isRecord(raw) || typeof raw.grantee !== "string") return null;
    return {
        grantee: raw.grantee,
        grantor: asString(raw.grantor, ""),
        privilege: asString(raw.privilege, ""),
        grantable: asBoolean(raw.grantable, false)
    };
}

function parseCatalogIndex(raw: unknown): CatalogIndex | null {
    if (!isRecord(raw) || typeof raw.name !== "string") return null;
    return {
        name: raw.name,
        definition: asString(raw.definition, ""),
        method: asString(raw.method, "btree"),
        unique: asBoolean(raw.unique, false),
        primary: asBoolean(raw.primary, false),
        valid: asBoolean(raw.valid, true),
        backsConstraint: asBoolean(raw.backsConstraint, false),
        bytes: numberOrNull(raw.bytes),
        scans: numberOrNull(raw.scans),
        tuplesRead: numberOrNull(raw.tuplesRead),
        tuplesFetched: numberOrNull(raw.tuplesFetched)
    };
}

function parseStats(raw: unknown): CatalogTableStats | null {
    if (!isRecord(raw)) return null;
    const n = (key: string) => numberOrNull(raw[key]);
    const s = (key: string) => asNullableString(raw[key]);
    return {
        totalBytes: n("totalBytes"),
        tableBytes: n("tableBytes"),
        indexBytes: n("indexBytes"),
        toastBytes: n("toastBytes"),
        rowEstimate: n("rowEstimate"),
        liveTuples: n("liveTuples"),
        deadTuples: n("deadTuples"),
        seqScans: n("seqScans"),
        seqTuplesRead: n("seqTuplesRead"),
        indexScans: n("indexScans"),
        indexTuplesFetched: n("indexTuplesFetched"),
        inserts: n("inserts"),
        updates: n("updates"),
        deletes: n("deletes"),
        lastVacuum: s("lastVacuum"),
        lastAutovacuum: s("lastAutovacuum"),
        lastAnalyze: s("lastAnalyze"),
        lastAutoanalyze: s("lastAutoanalyze")
    };
}

const RELATION_KINDS = ["table", "partitioned_table", "view", "materialized_view", "foreign_table"] as const;

export function parseTableDetails(raw: unknown): TableDetails | null {
    if (!isRecord(raw) || !isRecord(raw.relation)) return null;
    const relation = raw.relation;
    const fks = isRecord(raw.foreignKeys) ? raw.foreignKeys : {};
    return {
        relation: {
            schema: asString(relation.schema, "public"),
            name: asString(relation.name, ""),
            kind: RELATION_KINDS.find(kind => kind === relation.kind) ?? "table",
            owner: asString(relation.owner, ""),
            rlsEnabled: asBoolean(relation.rlsEnabled, false),
            rlsForced: asBoolean(relation.rlsForced, false),
            comment: asNullableString(relation.comment),
            defaultPrivileges: asBoolean(relation.defaultPrivileges, false)
        },
        columns: listOf(raw.columns, parseCatalogColumn),
        constraints: listOf(raw.constraints, parseConstraint),
        foreignKeys: { outgoing: listOf(fks.outgoing, parseForeignKey), incoming: listOf(fks.incoming, parseForeignKey) },
        triggers: listOf(raw.triggers, parseTrigger),
        grants: listOf(raw.grants, parseGrant),
        indexes: listOf(raw.indexes, parseCatalogIndex),
        stats: parseStats(raw.stats),
        ddl: asString(raw.ddl, "")
    };
}

// ── rows (`GET /tables/:t/rows`) ───────────────────────────────────────────

export type RowValue = string | null;
export type TableRow = Record<string, RowValue>;

export interface RowsPage {
    columns: CatalogColumn[];
    rows: TableRow[];
    count: { value: number; exact: boolean };
    primaryKey: string[];
    readOnly: boolean;
    readOnlyReason: "view" | "no_primary_key" | null;
}

export function parseRowsPage(raw: unknown): RowsPage {
    const record = isRecord(raw) ? raw : {};
    const count = isRecord(record.count) ? record.count : {};
    const rows = Array.isArray(record.rows)
        ? record.rows.filter(isRecord).map(row => {
            const out: TableRow = {};
            for (const [key, value] of Object.entries(row)) out[key] = value === null || value === undefined ? null : String(value);
            return out;
        })
        : [];
    const reason = record.readOnlyReason;
    return {
        columns: listOf(record.columns, parseCatalogColumn),
        rows,
        count: { value: asNumber(count.value, rows.length), exact: asBoolean(count.exact, true) },
        primaryKey: asStringArray(record.primaryKey),
        readOnly: asBoolean(record.readOnly, false),
        readOnlyReason: reason === "view" || reason === "no_primary_key" ? reason : null
    };
}

// ── links between Studio views ─────────────────────────────────────────────

/** `?table=schema.name` — the selected table. */
export const TABLE_PARAM = "table";
/** `?tableTab=policies` — the inspector tab (the hosted console owns `?tab=`). */
export const TABLE_TAB_PARAM = "tableTab";
/** `?tablesView=diagram` — the schema diagram instead of a table. */
export const TABLES_VIEW_PARAM = "tablesView";
/** `?tableFilter=[...]` — the Data tab's filters, as JSON. */
export const TABLE_FILTER_PARAM = "tableFilter";

export const INSPECTOR_TABS = ["data", "structure", "policies", "relations", "stats", "settings"] as const;
export type InspectorTab = typeof INSPECTOR_TABS[number];

export function isInspectorTab(value: unknown): value is InspectorTab {
    return INSPECTOR_TABS.some(tab => tab === value);
}

/** Opens a table in the Tables view, optionally on one tab and with Data filters. */
export function tablesLink(key: string, tab?: InspectorTab, filters?: readonly RowFilterValue[]): string {
    const params = new URLSearchParams({ [TABLE_PARAM]: key });
    if (tab) params.set(TABLE_TAB_PARAM, tab);
    if (filters && filters.length > 0) params.set(TABLE_FILTER_PARAM, JSON.stringify(filters));
    return `/tables?${params.toString()}`;
}

/** Opens the SQL editor with `sql` in a new tab. */
export function sqlDraftLink(sql: string): string {
    return `/sql?sqlDraft=${encodeURIComponent(sql)}`;
}

export const ROW_FILTER_OPERATORS = ["eq", "neq", "lt", "lte", "gt", "gte", "like", "ilike", "in", "is_null", "not_null"] as const;
export type RowFilterOperator = typeof ROW_FILTER_OPERATORS[number];

export interface RowFilterValue {
    column: string;
    op: RowFilterOperator;
    value?: string | string[];
}

export function parseFilterParam(raw: string | null): RowFilterValue[] {
    if (!raw) return [];
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(isRecord).flatMap((entry): RowFilterValue[] => {
            const op = ROW_FILTER_OPERATORS.find(candidate => candidate === entry.op);
            if (typeof entry.column !== "string" || !op) return [];
            const value = Array.isArray(entry.value)
                ? entry.value.map(item => String(item))
                : entry.value === undefined || entry.value === null ? undefined : String(entry.value);
            return [{ column: entry.column, op, ...(value !== undefined ? { value } : {}) }];
        });
    } catch {
        return [];
    }
}

/** Bytes as a reader says them: 1.2 MB, 830 kB. */
export function formatBytes(bytes: number | null): string {
    if (bytes === null) return "—";
    if (bytes < 1024) return `${bytes} B`;
    const units = ["kB", "MB", "GB", "TB"];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function formatCount(value: number | null, locale?: string): string {
    return value === null ? "—" : new Intl.NumberFormat(locale).format(value);
}
