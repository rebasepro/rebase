/**
 * Read the catalogs into a {@link DbSnapshot}.
 *
 * This is the only part of the tool that talks to a database, and it is written
 * on the assumption that it will be pointed at production by someone who has
 * never heard of us. So:
 *
 *   - The session is opened `default_transaction_read_only` and the work runs
 *     inside `BEGIN READ ONLY`. Not as a convention — as a guarantee, so that a
 *     bug here cannot write.
 *   - `statement_timeout` is set before anything else runs, so a scan of a large
 *     catalog cannot pin a connection.
 *   - Privileges are read from `pg_class.relacl` via `aclexplode`, not from
 *     `information_schema.role_table_grants`. The information_schema views only
 *     show grants involving roles the caller is a member of, so a non-superuser
 *     scanning a Supabase database would not see the grants to `anon` at all —
 *     it would report a clean bill of health on a wide-open table.
 *   - Every optional query is guarded: a server that lacks a catalog degrades
 *     that one fact, not the whole scan.
 */
import { Client } from "pg";
import type { ClientConfig } from "pg";

import { parseKeywordConnectionString } from "./redact";
import type {
    DbColumn,
    DbForeignKey,
    DbGrant,
    DbPolicy,
    DbRelation,
    DbRole,
    DbRoutine,
    DbSnapshot,
    DbView,
    PolicyCommand,
    PgRelationKind
} from "./types";

export interface ConnectOptions {
    connectionString: string;
    /** Explicit schema allowlist. Default: every non-system schema. */
    schemas?: string[];
    /** Default 15000. Applied as statement_timeout. */
    statementTimeoutMs?: number;
    /**
     * Roles an untrusted caller arrives as, named by whoever runs the scan.
     *
     * Added to {@link CANDIDATE_EXPOSED_ROLES} rather than replacing it: a
     * union can only widen what the checks consider, and for a security scanner
     * the safe direction of a wrong guess is more findings, not fewer.
     */
    roles?: string[];
}

/**
 * Facts about *the scan* rather than about the database.
 *
 * `Finding`/`DbSnapshot` have nowhere to put these, and the report needs both:
 * a TLS downgrade must be disclosed, and "we skipped 11 schemas" is the
 * difference between a clean result and a misleading one.
 */
export interface IntrospectDiagnostics {
    /**
     * True when the server demanded TLS, presented a certificate this machine
     * could not verify, and the scan retried with verification off. Common with
     * managed Postgres behind a pooler — and never done silently.
     */
    tlsVerificationDisabled: boolean;
    /** Schemas that exist but were not scanned, with why. */
    excludedSchemas: { schema: string; reason: "system" | "platform" | "not-requested" }[];
    /** Catalog queries that failed and the fact they cost us. */
    degraded: { what: string; error: string }[];
    /**
     * Roles holding DML on scanned tables that the scan does not treat as
     * exposed, and cannot explain as trusted.
     *
     * The exposed-role set is a list of names this tool happens to know
     * ({@link CANDIDATE_EXPOSED_ROLES}). A database served by a role under any
     * other name — `app_user`, `api`, `hasura` — matches nothing, every check
     * gates on a grant to an exposed role, and the run prints "No findings" on
     * a wide-open database. That is a false negative, which is the one failure
     * mode a security scanner must not have quietly.
     *
     * So: anything that holds DML and is neither recognised nor demonstrably
     * privileged is reported, with the `--role` flag as the fix. The scan still
     * cannot know whether such a role is reachable — but it can refuse to
     * imply that it looked.
     */
    unrecognizedGrantees: string[];
}

export interface IntrospectResult {
    snapshot: DbSnapshot;
    diagnostics: IntrospectDiagnostics;
}

const SYSTEM_SCHEMAS = ["pg_catalog", "information_schema", "pg_toast"];

/**
 * Schemas owned by the platform rather than by the person running the scan.
 *
 * Excluding these is the single biggest signal decision in the tool. Supabase's
 * `auth` and `storage` schemas contain dozens of tables with grants and no RLS
 * by design; a scan that reports forty findings inside them buries the one
 * finding in `public` that actually matters, and the reader concludes the tool
 * is wrong. They are still scannable — `--schema auth` opts back in.
 *
 * `rebase` is deliberately NOT on this list, though it is as much "ours" as
 * `auth` is Supabase's. It held refresh-token hashes, TOTP secrets and API-key
 * rows with RLS off and full DML granted to `rebase_user` — the exact shape
 * `rls-disabled` exists to catch — and this exclusion is why no scan ever said
 * so. Those grants are revoked at creation now (`revokeInternalTableSql`), so
 * scanning the schema is quiet; if a new internal table ships without its
 * revoke, `pnpm rls:check` fails instead of a reviewer having to notice. The
 * checks all gate on a grant to a reachable role, so an unexposed table still
 * produces nothing.
 */
const PLATFORM_SCHEMAS = [
    // Supabase
    "auth", "storage", "realtime", "_realtime", "vault", "extensions",
    "graphql", "graphql_public", "supabase_functions", "supabase_migrations",
    "net", "cron", "pgsodium", "pgsodium_masks",
    // Rebase
    "drizzle"
];

const RELATION_KINDS: Record<string, PgRelationKind> = {
    r: "table",
    p: "partitioned_table",
    v: "view",
    m: "materialized_view",
    f: "foreign_table"
};

const SCANNED_RELKINDS = ["r", "p", "v", "m", "f"];

/**
 * Roles an untrusted request plausibly arrives as. `service_role` is the
 * trusted bypass.
 *
 * These are recognised *by name*, which is the one place this tool is not
 * framework-agnostic: it knows Supabase's pair, PostgREST's `web_anon` and
 * Rebase's `rebase_user`, and nothing else. Every check gates on a grant to an
 * exposed role, so a database served by `app_user` used to scan clean no
 * matter how open it was.
 *
 * Two things close that hole, and neither is a guess about your schema:
 * `--role` names the role explicitly, and `unrecognizedGranteesFor` reports
 * write-holding roles that matched nothing here, so an unrecognised setup
 * produces a caveat instead of a green checkmark.
 */
const CANDIDATE_EXPOSED_ROLES = ["anon", "authenticated", "web_anon", "rebase_user"];

export async function introspect(opts: ConnectOptions): Promise<DbSnapshot> {
    return (await introspectWithDiagnostics(opts)).snapshot;
}

export async function introspectWithDiagnostics(opts: ConnectOptions): Promise<IntrospectResult> {
    const diagnostics: IntrospectDiagnostics = {
        tlsVerificationDisabled: false,
        excludedSchemas: [],
        degraded: [],
        unrecognizedGrantees: []
    };

    const { client, tlsVerificationDisabled } = await connect(opts.connectionString);
    diagnostics.tlsVerificationDisabled = tlsVerificationDisabled;

    try {
        const timeout = Math.max(1000, Math.floor(opts.statementTimeoutMs ?? 15000));
        await client.query(`SET statement_timeout = ${timeout}`);
        await client.query("SET default_transaction_read_only = on");
        await client.query("BEGIN READ ONLY");

        try {
            const snapshot = await readSnapshot(client, opts, diagnostics);
            await client.query("COMMIT");
            return { snapshot, diagnostics };
        } catch (error) {
            await client.query("ROLLBACK").catch(() => undefined);
            throw error;
        }
    } finally {
        await client.end().catch(() => undefined);
    }
}

// ---------------------------------------------------------------------------
// Connecting
// ---------------------------------------------------------------------------

type SslOption = false | { rejectUnauthorized: boolean };

/**
 * libpq keywords this tool can express as `pg` `Client` options.
 *
 * The list is an allowlist rather than a "map what we know and drop the rest",
 * because every keyword left out changes where the connection goes or how it is
 * verified: dropping `sslrootcert` would connect with weaker verification than
 * was asked for, and dropping `hostaddr` would connect to a different machine.
 * Silently doing either in a security scanner is worse than refusing.
 */
const SUPPORTED_KEYWORDS = new Set([
    "host",
    "port",
    "dbname",
    "user",
    "password",
    "sslmode",
    "application_name",
    "connect_timeout",
    "options"
]);

/**
 * The keywords in a libpq keyword string that this tool cannot honour, in the
 * order they were written. Empty for a URL, and empty for a keyword string it
 * can translate in full.
 */
export function unsupportedConnectionKeywords(connectionString: string): string[] {
    const keywords = parseKeywordConnectionString(connectionString);
    if (!keywords) return [];

    return [...keywords.keys()].filter((keyword) => !SUPPORTED_KEYWORDS.has(keyword));
}

/**
 * `Client` options for a libpq keyword string. Throws on a keyword it cannot
 * honour. Exported for the test that pins the translation: getting `host` or
 * `port` wrong here sends a production scan somewhere nobody asked for, and the
 * failure would still be reported against the host the user typed.
 */
export function clientConfigFromKeywords(keywords: Map<string, string>): ClientConfig {
    const unsupported = [...keywords.keys()].filter((keyword) => !SUPPORTED_KEYWORDS.has(keyword));
    if (unsupported.length > 0) {
        throw new Error(
            `Unsupported connection keyword${unsupported.length === 1 ? "" : "s"}: ${unsupported.join(", ")}. Use a postgresql:// URL instead.`
        );
    }

    const port = keywords.has("port") ? Number.parseInt(keywords.get("port")!, 10) : NaN;
    const timeoutSeconds = keywords.has("connect_timeout")
        ? Number.parseInt(keywords.get("connect_timeout")!, 10)
        : NaN;

    const config: ClientConfig = {
        host: keywords.get("host") ?? "localhost",
        database: keywords.get("dbname"),
        user: keywords.get("user"),
        password: keywords.get("password"),
        application_name: keywords.get("application_name"),
        options: keywords.get("options")
    };
    if (Number.isFinite(port)) config.port = port;
    if (Number.isFinite(timeoutSeconds)) config.connectionTimeoutMillis = timeoutSeconds * 1000;

    return config;
}

/**
 * Connect, negotiating TLS the way libpq would.
 *
 * `pg` lets the connection string override an explicit `ssl` option, so the
 * `sslmode` parameter is read and removed before the attempts are built —
 * otherwise the retry would silently reuse the setting that just failed.
 *
 * `pg` also cannot read the libpq keyword form (`host=… dbname=…`) at all — it
 * would connect to the default host and then report the failure against the
 * host the user *did* name, which is the worst of both. So that form is
 * translated into explicit `Client` options here, or refused.
 */
async function connect(connectionString: string): Promise<{ client: Client; tlsVerificationDisabled: boolean }> {
    const keywords = parseKeywordConnectionString(connectionString);
    const sslmode = keywords ? keywords.get("sslmode")?.toLowerCase() : readParam(connectionString, "sslmode");
    const base: ClientConfig = keywords
        ? clientConfigFromKeywords(keywords)
        : { connectionString: stripParam(connectionString, "sslmode") };

    // Each entry is (ssl option, did we give up verification to get here?).
    let attempts: { ssl: SslOption; downgraded: boolean }[];
    switch (sslmode) {
        case "disable":
            attempts = [{ ssl: false, downgraded: false }];
            break;
        case "require":
        case "no-verify":
            // libpq's `require` encrypts without verifying. Honouring that is not
            // a downgrade — it is what the connection string asked for.
            attempts = [{ ssl: { rejectUnauthorized: false }, downgraded: false }];
            break;
        case "verify-ca":
        case "verify-full":
            // An explicit request to verify is never quietly relaxed.
            attempts = [{ ssl: { rejectUnauthorized: true }, downgraded: false }];
            break;
        default:
            attempts = [
                { ssl: false, downgraded: false },
                { ssl: { rejectUnauthorized: true }, downgraded: false },
                { ssl: { rejectUnauthorized: false }, downgraded: true }
            ];
    }

    let lastError: unknown;
    for (const attempt of attempts) {
        const client = new Client({ ...base, ssl: attempt.ssl });
        try {
            await client.connect();
            return { client, tlsVerificationDisabled: attempt.downgraded };
        } catch (error) {
            lastError = error;
            await client.end().catch(() => undefined);
            if (!isTlsNegotiationError(error)) throw error;
        }
    }

    throw lastError;
}

/** Errors that mean "try a different TLS posture", as opposed to a real failure. */
function isTlsNegotiationError(error: unknown): boolean {
    const err = error as { code?: string; message?: string };
    const code = String(err?.code ?? "");
    const message = String(err?.message ?? "");

    if (
        [
            "DEPTH_ZERO_SELF_SIGNED_CERT",
            "SELF_SIGNED_CERT_IN_CHAIN",
            "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
            "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
            "CERT_HAS_EXPIRED",
            "ERR_TLS_CERT_ALTNAME_INVALID"
        ].includes(code)
    ) {
        return true;
    }

    return /SSL|TLS|certificate|self.signed|pg_hba\.conf entry .*SSL|sslmode/i.test(message);
}

function readParam(connectionString: string, name: string): string | undefined {
    const match = new RegExp(`[?&]${name}=([^&]*)`, "i").exec(connectionString);
    return match ? decodeURIComponent(match[1]).toLowerCase() : undefined;
}

function stripParam(connectionString: string, name: string): string {
    return connectionString
        .replace(new RegExp(`([?&])${name}=[^&]*&?`, "gi"), "$1")
        .replace(/[?&]$/, "");
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

interface Reader {
    query<R extends Record<string, unknown>>(
        what: string,
        text: string,
        values?: unknown[]
    ): Promise<R[]>;
}

function reader(client: Client, diagnostics: IntrospectDiagnostics): Reader {
    return {
        async query(what, text, values) {
            try {
                const result = await client.query(text, values);
                return result.rows;
            } catch (error) {
                // One catalog we could not read is a degraded fact, not a failed
                // scan — a server missing `pg_policies` should still tell us
                // which tables have RLS off.
                diagnostics.degraded.push({
                    what,
                    error: error instanceof Error ? error.message : String(error)
                });
                await client.query("ROLLBACK").catch(() => undefined);
                await client.query("BEGIN READ ONLY").catch(() => undefined);
                return [];
            }
        }
    };
}

async function readSnapshot(
    client: Client,
    opts: ConnectOptions,
    diagnostics: IntrospectDiagnostics
): Promise<DbSnapshot> {
    const db = reader(client, diagnostics);

    const [server] = await db.query<{
        version_num: string | number;
        version: string;
        role_name: string;
        is_super: boolean | null;
        bypass_rls: boolean | null;
    }>(
        "server version and current role",
        `SELECT current_setting('server_version_num') AS version_num,
                current_setting('server_version')     AS version,
                current_user                          AS role_name,
                (SELECT rolsuper      FROM pg_roles WHERE rolname = current_user) AS is_super,
                (SELECT rolbypassrls  FROM pg_roles WHERE rolname = current_user) AS bypass_rls`
    );

    const serverVersionNum = Number(server?.version_num ?? 0);
    const serverVersion = String(server?.version ?? "unknown");
    const currentRole = String(server?.role_name ?? "unknown");

    const allSchemas = (
        await db.query<{ nspname: string }>(
            "schema list",
            "SELECT nspname FROM pg_namespace ORDER BY nspname"
        )
    ).map((r) => r.nspname);

    const schemas = selectSchemas(allSchemas, opts.schemas, diagnostics);

    const roles = await readRoles(db);
    const relations = await readRelations(db, schemas);
    const policies = await readPolicies(db, schemas);
    const grants = await readGrants(db, schemas);
    const views = await readViews(db, schemas, serverVersionNum, relations);
    const foreignKeys = await readForeignKeys(db, schemas);
    const routines = await readRoutines(db, schemas);

    const exposedRoles = exposedRolesFor(roles, opts.roles);
    diagnostics.unrecognizedGrantees = unrecognizedGranteesFor(
        grants,
        roles,
        relations,
        exposedRoles,
        currentRole
    );

    return {
        serverVersionNum,
        serverVersion,
        currentRole,
        scannerIsPrivileged: isPrivileged(currentRole, server, roles, relations),
        schemas,
        exposedRoles,
        platform: detectPlatform(allSchemas, roles),
        relations,
        policies,
        roles,
        grants,
        views,
        foreignKeys,
        routines
    };
}

/**
 * Which of the database's schemas this scan covers.
 *
 * Exported for its own test: which schemas are in scope is a security decision,
 * not an implementation detail — a schema quietly added to
 * {@link PLATFORM_SCHEMAS} silently stops being checked.
 */
export function selectSchemas(
    all: string[],
    requested: string[] | undefined,
    diagnostics: IntrospectDiagnostics
): string[] {
    const isSystem = (s: string) =>
        SYSTEM_SCHEMAS.includes(s) || /^pg_temp(_\d+)?$/.test(s) || /^pg_toast_temp(_\d+)?$/.test(s);

    if (requested && requested.length > 0) {
        const wanted = new Set(requested);
        const kept: string[] = [];
        for (const schema of all) {
            if (wanted.has(schema)) kept.push(schema);
            else diagnostics.excludedSchemas.push({ schema, reason: "not-requested" });
        }
        return kept;
    }

    const kept: string[] = [];
    for (const schema of all) {
        if (isSystem(schema)) {
            diagnostics.excludedSchemas.push({ schema, reason: "system" });
            continue;
        }
        // `public` is never platform-internal, whatever it is named alongside.
        if (schema !== "public" && PLATFORM_SCHEMAS.includes(schema)) {
            diagnostics.excludedSchemas.push({ schema, reason: "platform" });
            continue;
        }
        kept.push(schema);
    }
    return kept;
}

async function readRoles(db: Reader): Promise<DbRole[]> {
    const rows = await db.query<{
        rolname: string;
        rolcanlogin: boolean;
        rolsuper: boolean;
        rolbypassrls: boolean | null;
    }>(
        "roles",
        "SELECT rolname, rolcanlogin, rolsuper, rolbypassrls FROM pg_roles ORDER BY rolname"
    );

    const edges = await db.query<{ role: string; member: string }>(
        "role memberships",
        `SELECT r.rolname AS role, m.rolname AS member
         FROM pg_auth_members am
         JOIN pg_roles r ON r.oid = am.roleid
         JOIN pg_roles m ON m.oid = am.member`
    );

    // Direct memberships, then a fixpoint. A grant to a role that `anon` inherits
    // is a grant to `anon`; a checker that compares grantee names literally
    // reports "clean" on exactly the databases whose owners took the most care.
    const direct = new Map<string, Set<string>>();
    for (const edge of edges) {
        if (!direct.has(edge.member)) direct.set(edge.member, new Set());
        direct.get(edge.member)!.add(edge.role);
    }

    const closure = new Map<string, Set<string>>();
    for (const role of rows) closure.set(role.rolname, new Set(direct.get(role.rolname) ?? []));

    let changed = true;
    while (changed) {
        changed = false;
        for (const [member, parents] of closure) {
            for (const parent of [...parents]) {
                for (const grandparent of closure.get(parent) ?? []) {
                    if (grandparent === member || parents.has(grandparent)) continue;
                    parents.add(grandparent);
                    changed = true;
                }
            }
        }
    }

    return rows.map((r) => ({
        name: r.rolname,
        canLogin: Boolean(r.rolcanlogin),
        superuser: Boolean(r.rolsuper),
        bypassRls: Boolean(r.rolbypassrls),
        memberOf: [...(closure.get(r.rolname) ?? [])].sort()
    }));
}

async function readRelations(db: Reader, schemas: string[]): Promise<DbRelation[]> {
    const rows = await db.query<{
        schema: string;
        name: string;
        kind: string;
        owner: string;
        rls_enabled: boolean;
        rls_forced: boolean;
        estimated_rows: string | number;
    }>(
        "relations",
        `SELECT n.nspname AS schema, c.relname AS name, c.relkind::text AS kind,
                pg_get_userbyid(c.relowner) AS owner,
                c.relrowsecurity      AS rls_enabled,
                c.relforcerowsecurity AS rls_forced,
                c.reltuples::float8   AS estimated_rows
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind::text = ANY($2) AND n.nspname = ANY($1)
         ORDER BY n.nspname, c.relname`,
        [schemas, SCANNED_RELKINDS]
    );

    const columns = await readColumns(db, schemas);

    return rows.map((r) => ({
        schema: r.schema,
        name: r.name,
        kind: RELATION_KINDS[r.kind] ?? "table",
        owner: r.owner,
        // Postgres reports these false for views; do not infer anything from it.
        rlsEnabled: Boolean(r.rls_enabled),
        rlsForced: Boolean(r.rls_forced),
        columns: columns.get(`${r.schema}.${r.name}`) ?? [],
        estimatedRows: Number(r.estimated_rows ?? -1)
    }));
}

async function readColumns(db: Reader, schemas: string[]): Promise<Map<string, DbColumn[]>> {
    const rows = await db.query<{
        schema: string;
        table_name: string;
        name: string;
        type: string;
        not_null: boolean;
        is_pk: boolean | null;
    }>(
        "columns",
        `SELECT n.nspname AS schema, c.relname AS table_name, a.attname AS name,
                format_type(a.atttypid, a.atttypmod) AS type,
                a.attnotnull AS not_null,
                EXISTS (
                    SELECT 1 FROM pg_index i
                    WHERE i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY(i.indkey)
                ) AS is_pk
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE a.attnum > 0 AND NOT a.attisdropped
           AND c.relkind::text = ANY($2) AND n.nspname = ANY($1)
         ORDER BY n.nspname, c.relname, a.attnum`,
        [schemas, SCANNED_RELKINDS]
    );

    const map = new Map<string, DbColumn[]>();
    for (const row of rows) {
        const key = `${row.schema}.${row.table_name}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push({
            name: row.name,
            type: row.type,
            notNull: Boolean(row.not_null),
            isPrimaryKey: Boolean(row.is_pk)
        });
    }
    return map;
}

async function readPolicies(db: Reader, schemas: string[]): Promise<DbPolicy[]> {
    const rows = await db.query<{
        schemaname: string;
        tablename: string;
        policyname: string;
        permissive: string;
        roles: string[] | string;
        cmd: string;
        qual: string | null;
        with_check: string | null;
    }>(
        "policies",
        `SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
         FROM pg_policies
         WHERE schemaname = ANY($1)
         ORDER BY schemaname, tablename, policyname`,
        [schemas]
    );

    return rows.map((r) => ({
        schema: r.schemaname,
        table: r.tablename,
        name: r.policyname,
        permissive: String(r.permissive ?? "PERMISSIVE").toUpperCase() !== "RESTRICTIVE",
        // node-postgres yields text[] as an array; some drivers hand back "{a,b}".
        roles: Array.isArray(r.roles)
            ? r.roles
            : String(r.roles ?? "")
                  .replace(/^\{|\}$/g, "")
                  .split(",")
                  .map((s) => s.trim().replace(/^"|"$/g, ""))
                  .filter(Boolean),
        command: (String(r.cmd ?? "ALL").toUpperCase() as PolicyCommand) ?? "ALL",
        using: r.qual,
        withCheck: r.with_check
    }));
}

async function readGrants(db: Reader, schemas: string[]): Promise<DbGrant[]> {
    const rows = await db.query<{
        schema: string;
        table_name: string;
        grantee: string;
        privilege_type: string;
    }>(
        "table privileges",
        `SELECT n.nspname AS schema, c.relname AS table_name,
                CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
                a.privilege_type
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r'::"char", c.relowner))) a
         WHERE c.relkind::text = ANY($2) AND n.nspname = ANY($1)`,
        [schemas, SCANNED_RELKINDS]
    );

    const known = new Set(["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]);
    const map = new Map<string, DbGrant>();
    for (const row of rows) {
        // PG17 added MAINTAIN; anything unknown is not exposure and is dropped.
        if (!known.has(row.privilege_type)) continue;
        const key = `${row.schema}.${row.table_name}.${row.grantee}`;
        if (!map.has(key)) {
            map.set(key, {
                schema: row.schema,
                table: row.table_name,
                grantee: row.grantee,
                privileges: []
            });
        }
        map.get(key)!.privileges.push(row.privilege_type as DbGrant["privileges"][number]);
    }
    return [...map.values()];
}

async function readViews(
    db: Reader,
    schemas: string[],
    serverVersionNum: number,
    relations: DbRelation[]
): Promise<DbView[]> {
    const rows = await db.query<{
        schema: string;
        name: string;
        owner: string;
        kind: string;
        reloptions: string[] | null;
    }>(
        "views",
        `SELECT n.nspname AS schema, c.relname AS name, pg_get_userbyid(c.relowner) AS owner,
                c.relkind::text AS kind, c.reloptions
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind = ANY(ARRAY['v','m']) AND n.nspname = ANY($1)
         ORDER BY n.nspname, c.relname`,
        [schemas]
    );

    const dependencies = await readViewDependencies(db, schemas, relations);

    return rows.map((r) => ({
        schema: r.schema,
        name: r.name,
        owner: r.owner,
        // The option does not exist before PG 15, and never applies to a
        // materialized view. `null` means "the question does not apply here",
        // which is what the dependent check keys its wording off.
        securityInvoker:
            serverVersionNum < 150000 || r.kind === "m"
                ? null
                : (r.reloptions ?? []).some((o) => /^security_invoker=(true|on)$/i.test(o)),
        dependsOn: dependencies.get(`${r.schema}.${r.name}`) ?? []
    }));
}

/**
 * Base relations of each view, resolved through `pg_depend` → `pg_rewrite`.
 *
 * Deliberately transitive: a view over a view over a protected table is still a
 * path to that table, and the intermediate view's own options do not save it
 * (the outer view still executes as its own owner). Base tables are not filtered
 * to the scanned schemas — a view in `public` reading a hidden schema is exactly
 * the case worth catching.
 */
async function readViewDependencies(
    db: Reader,
    schemas: string[],
    relations: DbRelation[]
): Promise<Map<string, { schema: string; table: string }[]>> {
    const rows = await db.query<{
        view_schema: string;
        view_name: string;
        ref_schema: string;
        ref_name: string;
    }>(
        "view dependencies",
        `SELECT DISTINCT dn.nspname AS view_schema, dc.relname AS view_name,
                rn.nspname AS ref_schema, rc.relname AS ref_name
         FROM pg_depend d
         JOIN pg_rewrite rw ON rw.oid = d.objid
         JOIN pg_class dc ON dc.oid = rw.ev_class
         JOIN pg_namespace dn ON dn.oid = dc.relnamespace
         JOIN pg_class rc ON rc.oid = d.refobjid
         JOIN pg_namespace rn ON rn.oid = rc.relnamespace
         WHERE d.classid = 'pg_rewrite'::regclass
           AND d.refclassid = 'pg_class'::regclass
           AND dc.oid <> rc.oid
           AND dc.relkind = ANY(ARRAY['v','m'])
           AND rc.relkind::text = ANY($2)
           AND dn.nspname = ANY($1)`,
        [schemas, SCANNED_RELKINDS]
    );

    const direct = new Map<string, Set<string>>();
    for (const row of rows) {
        const key = `${row.view_schema}.${row.view_name}`;
        if (!direct.has(key)) direct.set(key, new Set());
        direct.get(key)!.add(`${row.ref_schema}.${row.ref_name}`);
    }

    const isView = new Set(
        relations
            .filter((r) => r.kind === "view" || r.kind === "materialized_view")
            .map((r) => `${r.schema}.${r.name}`)
    );

    const out = new Map<string, { schema: string; table: string }[]>();
    for (const key of direct.keys()) {
        const seen = new Set<string>();
        const queue = [...(direct.get(key) ?? [])];
        while (queue.length > 0) {
            const next = queue.shift()!;
            if (next === key || seen.has(next)) continue;
            seen.add(next);
            if (isView.has(next)) queue.push(...(direct.get(next) ?? []));
        }
        out.set(
            key,
            [...seen].map((ref) => {
                const dot = ref.indexOf(".");
                return { schema: ref.slice(0, dot), table: ref.slice(dot + 1) };
            })
        );
    }
    return out;
}

async function readForeignKeys(db: Reader, schemas: string[]): Promise<DbForeignKey[]> {
    const rows = await db.query<{
        schema: string;
        table_name: string;
        ref_schema: string;
        ref_table: string;
        columns: string[] | null;
        ref_columns: string[] | null;
    }>(
        "foreign keys",
        `SELECT n.nspname AS schema, c.relname AS table_name,
                rn.nspname AS ref_schema, rc.relname AS ref_table,
                -- The ::text cast is load-bearing: attname is of type name, so
                -- array_agg yields name[] (OID 1003), which node-pg has no parser
                -- for and hands back as the raw literal "{post_id}". The declared
                -- string[] then lies, every column comparison silently fails to
                -- match, and junction-table-unprotected could never fire.
                (SELECT array_agg(att.attname::text ORDER BY k.ord)
                 FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
                 JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum) AS columns,
                -- The ::text cast is load-bearing: attname is of type name, so
                -- array_agg yields name[] (OID 1003), which node-pg has no parser
                -- for and hands back as the raw literal "{post_id}". The declared
                -- string[] then lies, every column comparison silently fails to
                -- match, and junction-table-unprotected could never fire.
                (SELECT array_agg(att.attname::text ORDER BY k.ord)
                 FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
                 JOIN pg_attribute att ON att.attrelid = con.confrelid AND att.attnum = k.attnum) AS ref_columns
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_class rc ON rc.oid = con.confrelid
         JOIN pg_namespace rn ON rn.oid = rc.relnamespace
         WHERE con.contype = 'f' AND n.nspname = ANY($1)
         ORDER BY n.nspname, c.relname, con.conname`,
        [schemas]
    );

    return rows.map((r) => ({
        schema: r.schema,
        table: r.table_name,
        columns: r.columns ?? [],
        refSchema: r.ref_schema,
        refTable: r.ref_table,
        refColumns: r.ref_columns ?? []
    }));
}

async function readRoutines(db: Reader, schemas: string[]): Promise<DbRoutine[]> {
    const rows = await db.query<{
        schema: string;
        name: string;
        owner: string;
        security_definer: boolean;
        proconfig: string[] | null;
    }>(
        "routines",
        `SELECT n.nspname AS schema, p.proname AS name, pg_get_userbyid(p.proowner) AS owner,
                p.prosecdef AS security_definer, p.proconfig
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = ANY($1) AND p.prokind = ANY(ARRAY['f','p'])
         ORDER BY n.nspname, p.proname`,
        [schemas]
    );

    return rows.map((r) => ({
        schema: r.schema,
        name: r.name,
        owner: r.owner,
        securityDefiner: Boolean(r.security_definer),
        mutableSearchPath: !(r.proconfig ?? []).some((c) => /^search_path=/i.test(c))
    }));
}

// ---------------------------------------------------------------------------
// Derived facts
// ---------------------------------------------------------------------------

/**
 * Can the scanning role see past RLS?
 *
 * Reported rather than corrected. A privileged scanner reads the true catalog,
 * which is what makes the findings accurate — but every finding then describes
 * what some *other* role gets, and the report has to say so or a reader will
 * assume the tool tested its own access.
 */
function isPrivileged(
    currentRole: string,
    server: { is_super?: boolean | null; bypass_rls?: boolean | null } | undefined,
    roles: DbRole[],
    relations: DbRelation[]
): boolean {
    if (server?.is_super || server?.bypass_rls) return true;

    const me = roles.find((r) => r.name === currentRole);
    if (me?.superuser || me?.bypassRls) return true;

    // Membership in a privileged role is the same power, one SET ROLE away.
    const inherited = new Set(me?.memberOf ?? []);
    if (roles.some((r) => inherited.has(r.name) && (r.superuser || r.bypassRls))) return true;

    // Ownership exempts from non-FORCE RLS on the owned tables.
    return relations.some((r) => r.owner === currentRole || inherited.has(r.owner));
}

/**
 * Which platform is in front of this database.
 *
 * Cheap and total: it reads the schema and role lists that were already
 * fetched, so a database missing any of these catalogs falls through to
 * `unknown` rather than erroring. The answer only ever changes the *wording* and
 * severity of `policy-anonymous-tautology`, so guessing wrong degrades a message
 * rather than inventing or hiding a finding.
 */
function detectPlatform(allSchemas: string[], roles: DbRole[]): DbSnapshot["platform"] {
    const schema = new Set(allSchemas);
    const role = new Set(roles.map((r) => r.name));

    if (
        schema.has("auth") &&
        schema.has("storage") &&
        (role.has("anon") || role.has("authenticated") || role.has("service_role"))
    ) {
        return "supabase";
    }

    if (role.has("rebase_user") || schema.has("rebase")) return "rebase";
    if (role.has("web_anon")) return "postgrest";
    if (role.has("neon_superuser") || schema.has("neon")) return "neon";

    return "unknown";
}

/**
 * Roles an untrusted caller plausibly arrives as.
 *
 * `service_role` is excluded on purpose. It exists, and it is in `roles`, but it
 * is the *trusted* bypass identity: treating it as exposed would flag every
 * table in every Supabase project as critical, which is both useless and wrong.
 */
function exposedRolesFor(roles: DbRole[], explicit?: string[]): string[] {
    const present = new Set(roles.map((r) => r.name));
    const named = [...CANDIDATE_EXPOSED_ROLES, ...(explicit ?? [])];
    // A role named with `--role` that does not exist is dropped here rather
    // than carried: `effectivePrivileges` would find nothing for it anyway, and
    // a phantom entry in `exposedRoles` reads like the scan covered something
    // it did not. `unrecognizedGranteesFor` reports the mismatch instead.
    return ["PUBLIC", ...new Set(named.filter((r) => present.has(r)))];
}

/**
 * Roles that hold DML on a scanned table and are neither exposed nor trusted.
 *
 * "Trusted" is deliberately generous — every role this can explain is one the
 * user does not have to think about. A grantee is explained when it is a
 * superuser, holds BYPASSRLS (RLS is a no-op for it, so no policy this tool
 * checks would constrain it anyway), owns the relation, is the role the scan
 * connected as, or is platform bookkeeping (`pg_*`, `cloudsql*`, Supabase's
 * `service_role`, which is the documented trusted bypass).
 *
 * What is left is the interesting set: a named role, holding write privileges,
 * that this tool has no opinion about. It may be a service account nothing can
 * authenticate as — `rebase_user` is NOLOGIN by design — or it may be exactly
 * the role the API connects as. The scan cannot tell from the catalog, so it
 * names them and lets the reader decide.
 */
function unrecognizedGranteesFor(
    grants: DbGrant[],
    roles: DbRole[],
    relations: DbRelation[],
    exposed: string[],
    currentRole: string
): string[] {
    const exposedSet = new Set(exposed.map((r) => r.toLowerCase()));
    const byName = new Map(roles.map((r) => [r.name.toLowerCase(), r]));
    const owners = new Set(relations.map((r) => r.owner.toLowerCase()));
    const writeable = new Set(["INSERT", "UPDATE", "DELETE"]);

    const out = new Set<string>();
    for (const grant of grants) {
        const name = grant.grantee;
        const key = name.toLowerCase();

        if (exposedSet.has(key) || isPublicName(name)) continue;
        if (key === currentRole.toLowerCase()) continue;
        if (owners.has(key)) continue;
        if (key.startsWith("pg_") || key.startsWith("cloudsql") || key === "service_role") continue;

        const role = byName.get(key);
        if (role?.superuser || role?.bypassRls) continue;

        // SELECT alone on a reference table is a normal, deliberate grant. It is
        // the write privileges that make an unrecognised role worth a sentence.
        if (!grant.privileges.some((p) => writeable.has(p))) continue;

        out.add(name);
    }
    return [...out].sort();
}

function isPublicName(name: string): boolean {
    return name.toUpperCase() === "PUBLIC";
}
