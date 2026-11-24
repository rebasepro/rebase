import { Hono, type Context } from "hono";
import { isIlikeSearchable } from "@rebasepro/common";
import type { DatabaseHealthSample, SQLAdmin, TableDescriptor } from "@rebasepro/types";
import { ApiError, errorHandler, extractDbError } from "../api/errors";
import type { HonoEnv } from "../api/types";
import { ddlRefusal, PROTECTED_SCHEMAS, quoteIdent } from "./db-sql-guards";
import { createSourceResolver, DEFAULT_SOURCE_KEY, type DbSqlSource } from "./db-sources";

/**
 * Database health and advice for the Studio's Database view
 * (`/api/admin/db/insights`).
 *
 * Everything here reads the system catalogs and statistics views through the
 * server's own SQL admin connection. The three writes — resetting
 * `pg_stat_statements`, cancelling a query, terminating a session — preview
 * their statement with `dryRun: true`, as every `/api/admin/db` mutation does.
 *
 * Sessions are those of this database only: a server shared by several
 * databases never shows, cancels or terminates another database's sessions.
 *
 * A backend can serve several databases (`database("analytics")` in
 * `config/resources.ts`). Every route takes `?source=<key>` to answer for one
 * of them; without it, the default database answers. `GET /sources` lists them.
 */

export type AdvisorSeverity = "info" | "low" | "medium" | "high" | "critical";

/** One piece of advice about the database. */
export interface AdvisorFinding {
    /** Unique within one response: the check, the table and the object. */
    id: string;
    /** The check that produced it, stable across runs (`unused-index`, `rls-disabled`). */
    check: string;
    category: "security" | "performance";
    severity: AdvisorSeverity;
    title: string;
    detail: string;
    /** `schema.table`, when the finding is about one table. */
    table?: string;
    /** Statements that resolve it, to review and run in the SQL editor. */
    remediationSql?: string;
    /** Documentation for the check, when there is a page for it. */
    docs?: string;
}

/** What `/insights/queries` can say about `pg_stat_statements`. */
export type QueryStatsStatus = "ok" | "not_installed" | "not_preloaded" | "unavailable";

/**
 * The part of `@rebasepro/rls-check` the security advisors use.
 *
 * Declared here and loaded on first use rather than imported: the checker is
 * bundled into its own chunk, so a server that never opens the advisors never
 * loads it.
 */
export interface RlsCheckModule {
    introspectWith(
        query: (text: string, values?: unknown[]) => Promise<Record<string, unknown>[]>
    ): Promise<{ snapshot: RlsSnapshot; diagnostics: { degraded: { what: string; error: string }[] } }>;
    runChecks(snapshot: RlsSnapshot): RlsFinding[];
    remediationFor(snapshot: RlsSnapshot, finding: RlsFinding): { apply: string; sql: string | null };
}

/** Opaque to this module: only handed back to the checker. */
export type RlsSnapshot = object;

export interface RlsFinding {
    id: string;
    severity: AdvisorSeverity;
    title: string;
    detail: string;
    impact: string;
    target: { schema: string; table?: string; view?: string; routine?: string; policy?: string };
    docs?: string;
}

export interface DbInsightsRoutesOptions {
    /** The default database's admin. */
    admin: SQLAdmin;
    /** The other SQL databases the backend serves, by data-source key. */
    sources?: () => readonly DbSqlSource[];
    /** The tables the server serves, for the unindexed-search advisor. */
    getServedTables: () => readonly TableDescriptor[];
    /** Loads the RLS checker. Defaults to `import("@rebasepro/rls-check")`. */
    loadRlsCheck?: () => Promise<RlsCheckModule>;
}

/** Above this many rows an unindexed search reads enough to matter — `rebase doctor`'s threshold. */
export const UNINDEXED_SEARCH_ROWS = 10_000;
/** A table this large that is read mostly by sequential scans is worth a look. */
const SEQ_SCAN_MIN_ROWS = 10_000;
const SEQ_SCAN_MIN_SCANS = 50;
/** Dead tuples above this share of the table, and this count, call for a vacuum. */
const DEAD_TUPLE_RATIO = 0.2;
const DEAD_TUPLE_MIN = 1_000;

const QUERY_SORTS = {
    total: "total_exec_time",
    mean: "mean_exec_time",
    calls: "calls"
} as const;
type QuerySort = keyof typeof QUERY_SORTS;
const isQuerySort = (value: string): value is QuerySort => Object.hasOwn(QUERY_SORTS, value);

const DEFAULT_QUERY_LIMIT = 20;
const MAX_QUERY_LIMIT = 100;

const PGLITE_VERSION_RE = /\(PGlite\b/i;
const NOT_PRELOADED_SQLSTATE = "55000";

/** The schemas advice is given about: everything but the system's and the framework's own. */
const USER_SCHEMA_FILTER = (column: string, param: string) =>
    `${column} <> ALL(${param}::text[]) AND ${column} NOT LIKE 'pg\\_%'`;
const excludedSchemas = (): string[] => [...PROTECTED_SCHEMAS];

const num = (value: unknown): number => {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};
const str = (value: unknown): string => (typeof value === "string" ? value : value === null || value === undefined ? "" : String(value));
const qualified = (schema: string, table: string) => `${quoteIdent(schema)}.${quoteIdent(table)}`;

function parseDryRun(body: unknown): boolean {
    return typeof body === "object" && body !== null && "dryRun" in body && body.dryRun === true;
}

async function readJsonBody(c: { req: { json(): Promise<unknown> } }): Promise<unknown> {
    try {
        return await c.req.json();
    } catch {
        return {};
    }
}

function parsePid(raw: string): number {
    const pid = Number(raw);
    if (!Number.isInteger(pid) || pid <= 0 || pid > 2_147_483_647) {
        throw ApiError.badRequest(`"${raw}" is not a backend process id.`, "INVALID_INPUT");
    }
    return pid;
}

/** True when this source is the in-process development database. */
async function isPglite(admin: SQLAdmin): Promise<boolean> {
    try {
        const [row] = await admin.executeSql("SELECT version() AS version");
        return PGLITE_VERSION_RE.test(str(row?.version));
    } catch {
        return false;
    }
}

/** `sampleDatabaseHealth`'s three reads, for a source that does not sample itself. */
async function sampleHealth(admin: SQLAdmin): Promise<DatabaseHealthSample> {
    if (admin.sampleHealth) return admin.sampleHealth();
    const sample: DatabaseHealthSample = {};
    const [connections, max, size] = await Promise.allSettled([
        admin.executeSql(`SELECT COALESCE(state, 'unknown') AS state, count(*)::int AS count
            FROM pg_stat_activity WHERE backend_type = 'client backend' GROUP BY 1`),
        admin.executeSql("SELECT current_setting('max_connections') AS max"),
        admin.executeSql("SELECT pg_database_size(current_database())::text AS bytes")
    ]);
    if (connections.status === "fulfilled") {
        sample.connections = Object.fromEntries(connections.value.map(row => [str(row.state), num(row.count)]));
    }
    if (max.status === "fulfilled") {
        const value = Number(max.value[0]?.max);
        if (Number.isFinite(value)) sample.maxConnections = value;
    }
    if (size.status === "fulfilled") {
        const value = Number(size.value[0]?.bytes);
        if (Number.isFinite(value)) sample.sizeBytes = value;
    }
    return sample;
}

// ── Performance advisors ───────────────────────────────────────────────────

async function unusedIndexes(admin: SQLAdmin): Promise<AdvisorFinding[]> {
    const rows = await admin.executeSql(
        `SELECT s.schemaname AS schema, s.relname AS table_name, s.indexrelname AS index_name,
                pg_relation_size(s.indexrelid)::bigint AS bytes,
                pg_size_pretty(pg_relation_size(s.indexrelid)) AS size
           FROM pg_stat_user_indexes s
           JOIN pg_index i ON i.indexrelid = s.indexrelid
          WHERE s.idx_scan = 0
            AND NOT i.indisprimary AND NOT i.indisunique
            AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = s.indexrelid)
            AND ${USER_SCHEMA_FILTER("s.schemaname", "$1")}
          ORDER BY bytes DESC, s.schemaname, s.relname, s.indexrelname`,
        { params: [excludedSchemas()] }
    );
    return rows.map(row => {
        const schema = str(row.schema);
        const table = str(row.table_name);
        const index = str(row.index_name);
        return {
            id: `unused-index:${schema}.${table}:${index}`,
            check: "unused-index",
            category: "performance",
            severity: "info",
            title: `Index ${index} on ${schema}.${table} has never been used`,
            detail: `No query has read this index since the statistics were last reset. It still takes ${str(row.size)} and slows every write to the table. An index created recently, or one used only by a rare report, also reads as unused.`,
            table: `${schema}.${table}`,
            remediationSql: `DROP INDEX ${qualified(schema, index)};`
        };
    });
}

async function duplicateIndexes(admin: SQLAdmin): Promise<AdvisorFinding[]> {
    const rows = await admin.executeSql(
        `SELECT n.nspname AS schema, t.relname AS table_name,
                json_agg(json_build_object(
                    'name', ic.relname,
                    'constraint', EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid)
                ) ORDER BY ic.relname) AS indexes
           FROM pg_index i
           JOIN pg_class ic ON ic.oid = i.indexrelid
           JOIN pg_class t ON t.oid = i.indrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE ${USER_SCHEMA_FILTER("n.nspname", "$1")}
          GROUP BY n.nspname, t.relname, i.indrelid, ic.relam, i.indkey::text, i.indclass::text,
                   i.indcollation::text, COALESCE(pg_get_expr(i.indexprs, i.indrelid), ''),
                   COALESCE(pg_get_expr(i.indpred, i.indrelid), '')
         HAVING count(*) > 1
          ORDER BY n.nspname, t.relname`,
        { params: [excludedSchemas()] }
    );
    const findings: AdvisorFinding[] = [];
    for (const row of rows) {
        const schema = str(row.schema);
        const table = str(row.table_name);
        const raw: unknown = typeof row.indexes === "string" ? JSON.parse(row.indexes) : row.indexes;
        if (!Array.isArray(raw)) continue;
        const indexes = raw
            .filter((entry): entry is { name: string; constraint: boolean } =>
                typeof entry === "object" && entry !== null && typeof entry.name === "string")
            .map(entry => ({ name: entry.name, constraint: entry.constraint === true }));
        // Keep the one a constraint stands on, or the first; the rest go.
        const keep = indexes.find(index => index.constraint) ?? indexes[0];
        const drop = indexes.filter(index => index !== keep && !index.constraint);
        if (!keep) continue;
        findings.push({
            id: `duplicate-index:${schema}.${table}:${indexes.map(index => index.name).join(",")}`,
            check: "duplicate-index",
            category: "performance",
            severity: "medium",
            title: `${schema}.${table} has ${indexes.length} identical indexes: ${indexes.map(index => index.name).join(", ")}`,
            detail: `These indexes cover the same columns in the same way, so queries use only one of them while every write maintains them all. Keep ${keep.name}.`,
            table: `${schema}.${table}`,
            ...(drop.length > 0 ? { remediationSql: drop.map(index => `DROP INDEX ${qualified(schema, index.name)};`).join("\n") } : {})
        });
    }
    return findings;
}

async function foreignKeysWithoutIndex(admin: SQLAdmin): Promise<AdvisorFinding[]> {
    const rows = await admin.executeSql(
        `SELECT n.nspname AS schema, t.relname AS table_name, c.conname AS constraint_name,
                array_agg(a.attname::text ORDER BY k.ord) AS columns
           FROM pg_constraint c
           JOIN pg_class t ON t.oid = c.conrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
           CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
          WHERE c.contype = 'f'
            AND NOT t.relispartition
            AND ${USER_SCHEMA_FILTER("n.nspname", "$1")}
            AND NOT EXISTS (
                SELECT 1 FROM pg_index i
                 WHERE i.indrelid = c.conrelid
                   AND i.indpred IS NULL
                   AND (string_to_array(i.indkey::text, ' ')::int2[])[1:cardinality(c.conkey)] @> c.conkey
            )
          GROUP BY n.nspname, t.relname, c.conname
          ORDER BY n.nspname, t.relname, c.conname`,
        { params: [excludedSchemas()] }
    );
    return rows.map(row => {
        const schema = str(row.schema);
        const table = str(row.table_name);
        const columns = Array.isArray(row.columns) ? row.columns.map(str) : str(row.columns).replace(/^\{|\}$/g, "").split(",");
        return {
            id: `fk-without-index:${schema}.${table}:${str(row.constraint_name)}`,
            check: "fk-without-index",
            category: "performance",
            severity: "low",
            title: `Foreign key ${str(row.constraint_name)} on ${schema}.${table} (${columns.join(", ")}) has no index`,
            detail: "Joins on this key, and every delete or key update on the referenced table, read the whole table to find the matching rows. An index on the referencing columns makes both a lookup.",
            table: `${schema}.${table}`,
            remediationSql: `CREATE INDEX ON ${qualified(schema, table)} (${columns.map(quoteIdent).join(", ")});`
        };
    });
}

async function tablesWithoutPrimaryKey(admin: SQLAdmin): Promise<AdvisorFinding[]> {
    const rows = await admin.executeSql(
        `SELECT n.nspname AS schema, t.relname AS table_name
           FROM pg_class t
           JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE t.relkind IN ('r', 'p')
            AND NOT t.relispartition
            AND ${USER_SCHEMA_FILTER("n.nspname", "$1")}
            AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = t.oid AND c.contype = 'p')
            AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = t.oid AND d.deptype = 'e')
          ORDER BY n.nspname, t.relname`,
        { params: [excludedSchemas()] }
    );
    return rows.map(row => {
        const schema = str(row.schema);
        const table = str(row.table_name);
        return {
            id: `no-primary-key:${schema}.${table}`,
            check: "no-primary-key",
            category: "performance",
            severity: "medium",
            title: `${schema}.${table} has no primary key`,
            detail: "Without a primary key a row cannot be addressed on its own: the API cannot read, update or delete one row, logical replication cannot send its updates, and duplicates go unnoticed.",
            table: `${schema}.${table}`
        };
    });
}

async function tableStatistics(admin: SQLAdmin): Promise<AdvisorFinding[]> {
    const rows = await admin.executeSql(
        `SELECT schemaname AS schema, relname AS table_name,
                seq_scan::bigint AS seq_scan, COALESCE(idx_scan, 0)::bigint AS idx_scan,
                n_live_tup::bigint AS live, n_dead_tup::bigint AS dead
           FROM pg_stat_user_tables
          WHERE ${USER_SCHEMA_FILTER("schemaname", "$1")}
          ORDER BY schemaname, relname`,
        { params: [excludedSchemas()] }
    );
    const findings: AdvisorFinding[] = [];
    for (const row of rows) {
        const schema = str(row.schema);
        const table = str(row.table_name);
        const live = num(row.live);
        const dead = num(row.dead);
        const seq = num(row.seq_scan);
        const idx = num(row.idx_scan);
        if (live >= SEQ_SCAN_MIN_ROWS && seq >= SEQ_SCAN_MIN_SCANS && seq > idx) {
            findings.push({
                id: `seq-scan-heavy:${schema}.${table}`,
                check: "seq-scan-heavy",
                category: "performance",
                severity: "low",
                title: `${schema}.${table} is read mostly by full scans`,
                detail: `About ${live} rows, read by ${seq} sequential scans against ${idx} index scans since the statistics were last reset. The queries that filter this table likely lack an index; Query performance shows which ones take the time.`,
                table: `${schema}.${table}`
            });
        }
        if (dead >= DEAD_TUPLE_MIN && dead > DEAD_TUPLE_RATIO * (live + dead)) {
            findings.push({
                id: `dead-tuples:${schema}.${table}`,
                check: "dead-tuples",
                category: "performance",
                severity: "low",
                title: `${schema}.${table} is ${Math.round((dead / (live + dead)) * 100)}% dead rows`,
                detail: `${dead} dead row versions against ${live} live ones. Autovacuum has not caught up, so scans read the dead rows too and the table takes more space than its data.`,
                table: `${schema}.${table}`,
                remediationSql: `VACUUM (ANALYZE) ${qualified(schema, table)};`
            });
        }
    }
    return findings;
}

/**
 * Served tables a search reads in full: no `search` block, a text column the
 * default `ILIKE '%term%'` search reads, and more rows than `rebase doctor`
 * warns at. The same rule as its `ilikeSearchedTables`, over the tables this
 * server serves.
 */
async function unindexedSearches(admin: SQLAdmin, tables: readonly TableDescriptor[]): Promise<AdvisorFinding[]> {
    const candidates = tables
        .filter(table => table.kind !== "view")
        .filter(table => !(table.search && Array.isArray(table.search.fields) && table.search.fields.length > 0))
        .map(table => ({ table, fields: table.columns.filter(column => isIlikeSearchable(column)).map(column => column.key) }))
        .filter(candidate => candidate.fields.length > 0);
    if (candidates.length === 0) return [];
    const rows = await admin.executeSql(
        `SELECT n.nspname AS schema, c.relname AS table_name,
                GREATEST(c.reltuples, COALESCE(s.n_live_tup, 0), 0)::bigint AS rows
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
          WHERE c.relkind IN ('r', 'p') AND n.nspname = ANY($1::text[])`,
        { params: [[...new Set(candidates.map(candidate => candidate.table.schema))]] }
    );
    const estimates = new Map(rows.map(row => [`${str(row.schema)}.${str(row.table_name)}`, num(row.rows)]));
    return candidates.flatMap(({ table, fields }) => {
        const key = `${table.schema}.${table.table}`;
        const count = estimates.get(key) ?? 0;
        if (count <= UNINDEXED_SEARCH_ROWS) return [];
        return [{
            id: `unindexed-search:${key}`,
            check: "unindexed-search",
            category: "performance" as const,
            severity: "low" as const,
            title: `Searching ${table.slug} reads all ${count} rows`,
            detail: `The table has no \`search\` block, so a search is ILIKE '%term%' over ${fields.join(", ")}, and each one — and its count — reads every row. A \`search\` block indexes it (full-text, or mode: "hybrid" for substrings too): https://rebase.pro/docs/backend/search`,
            table: key
        }];
    });
}

// ── Security advisors ──────────────────────────────────────────────────────

async function securityFindings(
    admin: SQLAdmin,
    loadRlsCheck: () => Promise<RlsCheckModule>
): Promise<{ findings: AdvisorFinding[]; degraded: string[] }> {
    const rlsCheck = await loadRlsCheck();
    const { snapshot, diagnostics } = await rlsCheck.introspectWith((text, values) =>
        admin.executeSql(text, values && values.length > 0 ? { params: values } : undefined));
    const findings = rlsCheck.runChecks(snapshot).map((finding, index): AdvisorFinding => {
        const remediation = rlsCheck.remediationFor(snapshot, finding);
        const target = finding.target;
        const object = target.policy ?? target.view ?? target.routine ?? "";
        return {
            id: `${finding.id}:${target.schema}.${target.table ?? target.view ?? target.routine ?? ""}:${object}:${index}`,
            check: finding.id,
            category: "security",
            severity: finding.severity,
            title: finding.title,
            detail: finding.impact ? `${finding.detail} ${finding.impact}` : finding.detail,
            ...(target.table ? { table: `${target.schema}.${target.table}` } : {}),
            ...(remediation.apply === "sql" && remediation.sql ? { remediationSql: remediation.sql } : {}),
            ...(finding.docs ? { docs: finding.docs } : {})
        };
    });
    return { findings, degraded: diagnostics.degraded.map(entry => entry.what) };
}

const SEVERITY_RANK: Record<AdvisorSeverity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

/** The installed `pg_stat_statements`' schema, or null when it is not installed. */
async function statementsSchema(admin: SQLAdmin): Promise<string | null> {
    const [row] = await admin.executeSql(
        `SELECT n.nspname AS schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
          WHERE e.extname = 'pg_stat_statements'`
    );
    return row ? str(row.schema) : null;
}

async function extensionAvailable(admin: SQLAdmin, name: string): Promise<boolean> {
    try {
        const rows = await admin.executeSql("SELECT 1 FROM pg_available_extensions WHERE name = $1", { params: [name] });
        return rows.length > 0;
    } catch {
        return false;
    }
}

export function createDbInsightsRoutes({
    admin: defaultAdmin,
    sources,
    getServedTables,
    loadRlsCheck = () => import("@rebasepro/rls-check")
}: DbInsightsRoutesOptions): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    router.onError(errorHandler);
    const databases = createSourceResolver(defaultAdmin, sources);
    const adminFor = (c: Context<HonoEnv>) => databases.resolve(c.req.query("source"));

    router.get("/sources", (c) => c.json({
        sources: databases.list().map(source => ({ key: source.key, isDefault: source.key === DEFAULT_SOURCE_KEY }))
    }));

    // ── Overview: version, size, connections ──
    router.get("/overview", async (c) => {
        const { admin, key } = adminFor(c);
        const [identity] = await admin.executeSql(
            "SELECT version() AS version, current_setting('server_version') AS server_version, current_database() AS database"
        );
        const version = str(identity?.version);
        const health = await sampleHealth(admin).catch((): DatabaseHealthSample => ({}));
        const byState = health.connections ?? {};
        const used = Object.values(byState).reduce((sum, count) => sum + count, 0);
        return c.json({
            source: key,
            engine: PGLITE_VERSION_RE.test(version) ? "pglite" : "postgres",
            version,
            serverVersion: str(identity?.server_version),
            database: str(identity?.database),
            sizeBytes: health.sizeBytes ?? null,
            connections: {
                used: health.connections ? used : null,
                max: health.maxConnections ?? null,
                byState
            }
        });
    });

    // ── Advisors: security (rls-check) and performance ──
    router.get("/advisors", async (c) => {
        const { admin, key } = adminFor(c);
        const servedHere = getServedTables().filter(table => (table.database ?? DEFAULT_SOURCE_KEY) === key);
        const performanceChecks = [
            unusedIndexes(admin),
            duplicateIndexes(admin),
            foreignKeysWithoutIndex(admin),
            tablesWithoutPrimaryKey(admin),
            tableStatistics(admin),
            unindexedSearches(admin, servedHere)
        ];
        const [[security], performance] = await Promise.all([
            Promise.allSettled([securityFindings(admin, loadRlsCheck)]),
            Promise.allSettled(performanceChecks)
        ]);

        const findings: AdvisorFinding[] = [];
        const errors: { category: "security" | "performance"; message: string }[] = [];
        let degraded: string[] = [];
        if (security.status === "fulfilled") {
            findings.push(...security.value.findings);
            degraded = security.value.degraded;
        } else {
            errors.push({ category: "security", message: security.reason instanceof Error ? security.reason.message : String(security.reason) });
        }
        for (const result of performance) {
            if (result.status === "fulfilled") findings.push(...result.value);
            else errors.push({ category: "performance", message: result.reason instanceof Error ? result.reason.message : String(result.reason) });
        }
        findings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
            || a.category.localeCompare(b.category)
            || a.title.localeCompare(b.title));
        return c.json({ generatedAt: new Date().toISOString(), findings, errors, degraded });
    });

    // ── Query performance: pg_stat_statements ──
    router.get("/queries", async (c) => {
        const sort = c.req.query("sort") ?? "total";
        if (!isQuerySort(sort)) {
            throw ApiError.badRequest(`Unknown sort "${sort}". Use total, mean or calls.`, "INVALID_INPUT");
        }
        const { admin } = adminFor(c);
        const limitParam = Number(c.req.query("limit") ?? DEFAULT_QUERY_LIMIT);
        const limit = Number.isInteger(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_QUERY_LIMIT) : DEFAULT_QUERY_LIMIT;

        if (await isPglite(admin)) {
            return c.json({ status: "unavailable" satisfies QueryStatsStatus, sort, queries: [] });
        }
        const schema = await statementsSchema(admin);
        if (!schema) {
            return c.json({
                status: "not_installed" satisfies QueryStatsStatus,
                sort,
                queries: [],
                available: await extensionAvailable(admin, "pg_stat_statements")
            });
        }
        try {
            const rows = await admin.executeSql(
                `SELECT s.queryid::text AS query_id, s.query,
                        s.calls::bigint AS calls,
                        s.total_exec_time AS total_ms,
                        s.mean_exec_time AS mean_ms,
                        s.max_exec_time AS max_ms,
                        s.rows::bigint AS rows,
                        s.shared_blks_hit::bigint AS blocks_hit,
                        s.shared_blks_read::bigint AS blocks_read,
                        r.rolname AS role
                   FROM ${quoteIdent(schema)}.pg_stat_statements s
                   LEFT JOIN pg_roles r ON r.oid = s.userid
                  WHERE s.dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
                  ORDER BY s.${QUERY_SORTS[sort]} DESC
                  LIMIT $1`,
                { params: [limit] }
            );
            return c.json({
                status: "ok" satisfies QueryStatsStatus,
                sort,
                queries: rows.map(row => ({
                    queryId: str(row.query_id),
                    query: str(row.query),
                    calls: num(row.calls),
                    totalMs: num(row.total_ms),
                    meanMs: num(row.mean_ms),
                    maxMs: num(row.max_ms),
                    rows: num(row.rows),
                    blocksHit: num(row.blocks_hit),
                    blocksRead: num(row.blocks_read),
                    role: row.role === null || row.role === undefined ? null : str(row.role)
                }))
            });
        } catch (err) {
            if (extractDbError(err)?.code === NOT_PRELOADED_SQLSTATE) {
                return c.json({ status: "not_preloaded" satisfies QueryStatsStatus, sort, queries: [] });
            }
            throw ddlRefusal(err);
        }
    });

    router.post("/queries/reset", async (c) => {
        const { admin } = adminFor(c);
        const dryRun = parseDryRun(await readJsonBody(c));
        if (await isPglite(admin)) {
            throw ApiError.badRequest("Query statistics are not collected by the in-process development database.", "UNAVAILABLE");
        }
        const schema = await statementsSchema(admin);
        if (!schema) {
            throw ApiError.badRequest("pg_stat_statements is not installed on this database.", "NOT_INSTALLED");
        }
        const statement = `SELECT ${quoteIdent(schema)}.pg_stat_statements_reset();`;
        if (dryRun) return c.json({ dryRun: true, statements: [statement] });
        try {
            await admin.executeSql(statement);
        } catch (err) {
            if (extractDbError(err)?.code === NOT_PRELOADED_SQLSTATE) {
                throw ApiError.badRequest("pg_stat_statements is installed but not loaded: add it to shared_preload_libraries and restart the server.", "NOT_PRELOADED");
            }
            throw ddlRefusal(err);
        }
        return c.json({ dryRun: false, statements: [statement] });
    });

    // ── Activity: this database's sessions that are doing something ──
    router.get("/activity", async (c) => {
        const { admin } = adminFor(c);
        const rows = await admin.executeSql(
            `SELECT a.pid, a.usename AS username, a.application_name, a.client_addr::text AS client_addr,
                    a.state, a.wait_event_type, a.wait_event, a.query,
                    a.backend_start, a.xact_start, a.query_start,
                    (EXTRACT(EPOCH FROM (clock_timestamp() - COALESCE(a.query_start, a.xact_start, a.backend_start))) * 1000)::bigint AS duration_ms,
                    pg_blocking_pids(a.pid) AS blocked_by
               FROM pg_stat_activity a
              WHERE a.backend_type = 'client backend'
                AND a.pid <> pg_backend_pid()
                AND a.datid = (SELECT oid FROM pg_database WHERE datname = current_database())
                AND a.state IS DISTINCT FROM 'idle'
              ORDER BY duration_ms DESC NULLS LAST`
        );
        const toIso = (value: unknown): string | null =>
            value instanceof Date ? value.toISOString() : value === null || value === undefined ? null : str(value);
        const toPids = (value: unknown): number[] => {
            if (Array.isArray(value)) return value.map(num).filter(pid => pid > 0);
            if (typeof value === "string") return value.replace(/^\{|\}$/g, "").split(",").map(num).filter(pid => pid > 0);
            return [];
        };
        return c.json({
            sessions: rows.map(row => ({
                pid: num(row.pid),
                username: row.username === null || row.username === undefined ? null : str(row.username),
                applicationName: str(row.application_name),
                clientAddr: row.client_addr === null || row.client_addr === undefined ? null : str(row.client_addr),
                state: row.state === null || row.state === undefined ? null : str(row.state),
                waitEventType: row.wait_event_type === null || row.wait_event_type === undefined ? null : str(row.wait_event_type),
                waitEvent: row.wait_event === null || row.wait_event === undefined ? null : str(row.wait_event),
                query: str(row.query),
                backendStart: toIso(row.backend_start),
                xactStart: toIso(row.xact_start),
                queryStart: toIso(row.query_start),
                durationMs: num(row.duration_ms),
                blockedBy: toPids(row.blocked_by)
            }))
        });
    });

    const signalBackend = (fn: "pg_cancel_backend" | "pg_terminate_backend") => async (c: Context<HonoEnv>) => {
        const { admin } = adminFor(c);
        const pid = parsePid(c.req.param("pid") ?? "");
        const dryRun = parseDryRun(await readJsonBody(c));
        const statement = `SELECT ${fn}(${pid});`;
        const target = await admin.executeSql(
            `SELECT 1 FROM pg_stat_activity
              WHERE pid = $1
                AND backend_type = 'client backend'
                AND pid <> pg_backend_pid()
                AND datid = (SELECT oid FROM pg_database WHERE datname = current_database())`,
            { params: [pid] }
        );
        if (target.length === 0) {
            throw ApiError.notFound(`No session of this database has process id ${pid}.`, "SESSION_NOT_FOUND");
        }
        if (dryRun) return c.json({ dryRun: true, statements: [statement] });
        let signalled: boolean;
        try {
            const [row] = await admin.executeSql(`SELECT ${fn}($1) AS ok`, { params: [pid] });
            signalled = row?.ok === true || row?.ok === "t";
        } catch (err) {
            throw ddlRefusal(err);
        }
        return c.json({ dryRun: false, statements: [statement], signalled });
    };
    router.post("/activity/:pid/cancel", signalBackend("pg_cancel_backend"));
    router.post("/activity/:pid/terminate", signalBackend("pg_terminate_backend"));

    return router;
}
