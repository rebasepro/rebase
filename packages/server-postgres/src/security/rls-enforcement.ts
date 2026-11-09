import { sql as drizzleSql, SQL } from "drizzle-orm";
import { ANONYMOUS_USER_ID, PolicyExpression, SecurityRule } from "@rebasepro/types";
import {
    AnonymousGrantRisk,
    findAnonymousGrants,
    LOAD_REQUEST_ROLES_PLPGSQL,
    REBASE_INTERNAL_TABLES,
    REBASE_USER_ROLE,
    revokeInternalTableAccess,
    revokeInternalTableSql,
    securityRuleToConditions
} from "@rebasepro/common";
import { holdsAdminRole, REBASE_ADMIN_ROLE, REBASE_SCHEMA, usesLegacyRlsFunctions } from "@rebasepro/types";
import { logger } from "@rebasepro/server";
import { extractCauseMessage } from "../utils/error-cause";
import type { GrantsMode, ProvisionRoleMode, RequestIdentity, RlsSettings } from "./rls-settings";
import { VIEW_ROWS_COMMENT_PREFIX } from "../schema/plan/view-names";
import { ADMIN_POLICY_ROLE_SQL } from "../schema/rls-bootstrap-sql";

/**
 * Unified RLS enforcement — the "user context vs server context" model.
 *
 * Every operation runs in one of two contexts:
 *
 *  - **User context** — a request authenticated (or anonymous) via
 *    `driver.withAuth(user)`. Runs as the restricted `rebase_user` role: a
 *    non-owner, NOSUPERUSER, NOBYPASSRLS role, so Postgres RLS binds *every*
 *    statement (SELECT, INSERT, UPDATE, DELETE). The collection's
 *    `securityRules` are the whole authorization model; app-layer callbacks
 *    are validation/side-effects, not a security boundary.
 *
 *  - **Server context** — the base (owner) connection: auth flows, migrations,
 *    and raw `rebase.sql`. As table owner it bypasses RLS. This is the trusted
 *    plane, equivalent to Supabase's `service_role`.
 *
 *    `rebase.dataAsAdmin` is **not** in it, despite the name. `init.ts` scopes
 *    that driver with `withAuth(SERVICE_IDENTITY)`, so it arrives as user
 *    context above — `rebase_user`, `app.uid = 'service'`, policies evaluated —
 *    and clears the default policies through their admin arm rather than the
 *    `rebase.uid() IS NULL` one.
 *
 * This module provides the three pieces:
 *
 *  1. {@link detectConnectionPosture} — is the connection subject to RLS at
 *     all? (superuser / BYPASSRLS / table owner ⇒ no)
 *  2. {@link ensureAppRole} — idempotently provision `rebase_user` with
 *     SELECT/INSERT/UPDATE/DELETE grants (+ default privileges so future
 *     tables stay covered).
 *  3. {@link applyAuthContext} — per-transaction: set the `app.*` GUCs the
 *     policies read (`rebase.uid()` etc.) and the transaction-local role
 *     `rebase_user` so RLS binds, in one statement. Transaction-scoped, so it
 *     composes with poolers.
 *
 * Provisioning runs from the framework's own bootstrap/migrate (which already
 * self-creates the `auth` schema and functions) — enforcement is default-on,
 * not an operator opt-in.
 */

/**
 * The restricted role every authenticated (user-context) request runs as.
 *
 * Re-exported, not re-declared: the same name is needed by
 * `@rebasepro/common`'s internal-table revokes, and two spellings of a role name
 * fail as a silent no-op rather than an error.
 */
export { REBASE_USER_ROLE };

/** Minimal SQL runner so callers can adapt drizzle or pg.Client. */
export type RawSqlRunner = (sqlText: string) => Promise<Record<string, unknown>[]>;

/** Minimal transaction surface needed by {@link applyAuthContext}. */
export interface SqlTx {
    execute(query: SQL): Promise<unknown>;
}

export interface ConnectionPosture {
    /** The connection's `current_user`. */
    role: string;
    superuser: boolean;
    bypassRLS: boolean;
    /**
     * Owns at least one user table — owners bypass non-FORCE RLS.
     *
     * "Owns" in Postgres's sense, not by name: a role that INHERITs the owner is
     * the owner for every ownership test the planner makes, including the one
     * that decides whether a policy applies at all.
     */
    ownsTables: boolean;
    /**
     * May create tables somewhere the server writes — and would then own them.
     *
     * The reason this is part of the posture rather than a separate question:
     * the posture is decided ONCE, at boot, and on a fresh database the
     * catalogue has nothing to report yet. The process that asks then goes on to
     * create every table in the schema and owns all of them for the rest of its
     * life. Asking only what is already there answers about the wrong instant.
     */
    canCreateTables: boolean;
    /** True when RLS would NOT constrain this connection. */
    privileged: boolean;
}

export interface AuthContext {
    uid: string;
    /** Raw roles as carried on the user (strings or `{ id }` objects). */
    roles: unknown[];
    /**
     * Whether this session came from anonymous sign-in rather than an account.
     *
     * Anonymous sign-in mints a real user row and a real uid, so a guest was
     * indistinguishable from a registered account inside a policy: same
     * `rebase.uid()`, same default role. Every rule meaning "a signed-in
     * person" was therefore also a rule about anybody who had called
     * `POST /auth/anonymous`, which asks for no email, no password and no
     * agreement to anything.
     *
     * Optional, and absent reads as `false`: a caller that predates this — a
     * realtime subscription, a custom validator — keeps the behaviour it had
     * rather than having every one of its users reclassified as guests.
     */
    isAnonymous?: boolean;
    /**
     * The **custom** claims on the caller's token, as `rebase.jwt()` reports
     * them.
     *
     * This is how a policy reaches a fact about the session that is neither the
     * uid nor the roles — which, before this, it could not: `app.jwt` was built
     * from three fields the driver already had, so `rebase.jwt()`, documented
     * as "full JWT claims as JSONB", returned a three-key object that never had
     * a claim in it.
     *
     * Multi-tenancy's `claim` form is the first caller — `policy.authClaim(…)`
     * compiles to `rebase.jwt() ->> '<name>'`. Identity claims are stripped out
     * before they reach here (`AccessTokenPayload.claims`) and the identity
     * fields are written *over* them below, so nothing a hook put on a token
     * can assert a uid, roles or guest status.
     */
    claims?: Record<string, unknown>;
}

const quoteIdent = (name: string): string => `"${name.replace(/"/g, "\"\"")}"`;

/** A string literal for a catalogue read. Names come from config and constants, never from a request. */
const sqlLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;
const textArray = (values: readonly string[]): string =>
    values.length === 0 ? "ARRAY[]::text[]" : `ARRAY[${values.map(sqlLiteral).join(", ")}]::text[]`;
/** A `text[]` column as read back — an array, or `{a,b}` from a driver that hands arrays back as text. */
const textArrayValue = (value: unknown): string[] => Array.isArray(value)
    ? value.map(String)
    : String(value ?? "").replace(/^\{|\}$/g, "").split(",").filter(Boolean);

/** DML the user role holds on managed tables (RLS still filters per row). */
const USER_TABLE_PRIVILEGES = "SELECT, INSERT, UPDATE, DELETE";

/**
 * Take every privilege the request roles hold on one table back — what a
 * table gets when RLS cannot be switched on for it, so it is unreachable
 * rather than unprotected. Quoted exactly: a mixed-case adopted table
 * (`"User"`) folded to lower case names a table that does not exist.
 *
 * Every request role, as this database recorded them (`rls.requestRole`), and
 * each only if it exists: one statement, for the boot's policies step and its
 * final posture check alike, without either being handed the roles.
 */
export const revokeUserRoleSql = (schema: string, table: string): string => `
    DO $rebase_withhold$
    DECLARE
        request_roles text[];
        request_role text;
    BEGIN
        ${LOAD_REQUEST_ROLES_PLPGSQL}
        FOREACH request_role IN ARRAY request_roles LOOP
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = request_role) THEN
                EXECUTE format('REVOKE ALL PRIVILEGES ON %I.%I FROM %I', ${sqlLiteral(schema)}, ${sqlLiteral(table)}, request_role);
            END IF;
        END LOOP;
    END
    $rebase_withhold$
`.trim();

/**
 * Warn when the connection role shares its name with an existing schema.
 *
 * Postgres resolves unqualified names through `search_path`, which defaults to
 * `"$user", public` — and `$user` is the connection ROLE. When a schema of that
 * name exists it sits ahead of `public`, so every unqualified statement
 * silently operates on it instead:
 *
 *     CREATE TABLE posts (...);   -- you meant public.posts; you got <role>.posts
 *
 * Nothing errors. You get a second table of the same name in the wrong schema,
 * and reads that pin `public` cannot see it — which reads as "missing table" and
 * sends people to re-run a push that creates a *third* copy. The bootstrapper
 * has a whole branch dedicated to recognising the symptom after the fact.
 *
 * Rebase shipped straight into this: it creates a schema named `rebase` while
 * every template named the database role `rebase` too. The scaffold uses
 * `rebase_app` now, and every pool Rebase opens pins `search_path=public`
 * (`pinSearchPath`), which covers the paths the framework controls. This covers
 * the ones it does not — `psql`, `pg_dump`, drizzle-kit, a colleague's script,
 * a hand-written migration — because the hazard is a property of the two NAMES,
 * not of any one connection.
 *
 * A warning rather than a boot failure: the database works, the framework's own
 * traffic is pinned, and refusing to start over a naming choice a user may have
 * inherited would be worse than the risk.
 */
export async function warnOnRoleSchemaCollision(run: RawSqlRunner): Promise<void> {
    try {
        const rows = await run(`
            SELECT current_user AS role,
                   EXISTS (
                       SELECT 1 FROM pg_namespace n WHERE n.nspname = current_user
                   ) AS collides
        `);
        if (rows[0]?.collides !== true) return;
        const role = String(rows[0]?.role ?? "the connection role");
        logger.warn(
            `⚠️  The database role "${role}" has the same name as a schema. Postgres resolves unqualified ` +
            `names through \`search_path\`, which defaults to \`"$user", public\` — so "${role}" is searched ` +
            `BEFORE public, and any unqualified \`CREATE TABLE\`/\`SELECT\` from a tool that does not pin the ` +
            `path (psql, pg_dump, drizzle-kit, a hand-written migration) silently lands in "${role}" instead. ` +
            `Rebase's own connections pin \`search_path=public\`, so the server is unaffected. To remove the ` +
            `hazard entirely, connect as a role whose name is not also a schema — the scaffold uses ` +
            `"rebase_app".`
        );
    } catch {
        // A diagnostic must never be the reason a boot fails.
    }
}

/**
 * Would RLS actually constrain this connection?
 *
 * Four ways the answer is no, and only two of them are obvious. Superuser and
 * BYPASSRLS announce themselves in `pg_roles`. The other two are about
 * ownership, and both used to read as "no bypass here":
 *
 * - **Ownership through membership.** The old query compared
 *   `pg_tables.tableowner` to `current_user` as a string. Postgres does not: a
 *   role that INHERITs the owner passes every ownership test the planner makes,
 *   including the one that decides whether a policy applies. So a perfectly
 *   ordinary "app role that is a member of the owner role" setup reported
 *   unprivileged and bypassed every policy — permanently, since no restart
 *   changes a string comparison's answer.
 *
 * - **Ownership that has not happened yet.** The posture is decided once, at
 *   boot, and on a fresh database there is nothing in the catalogue to find. The
 *   same process then creates every table and owns all of them. The first boot
 *   of a new deployment therefore served every request unconstrained, the log
 *   said RLS was fine, and the SECOND boot silently fixed it — which is the
 *   worst possible shape for a security check, because the state that reproduces
 *   it is gone by the time anyone looks. Asking "may this role create tables
 *   where the server provisions?" answers about the process's whole life rather
 *   than about one instant of it.
 *
 * `schemas` narrows the CREATE question to where the server actually writes.
 * Omitted, it asks about every schema the role can see, which is the safe
 * direction: over-reporting costs a role switch that was not strictly needed,
 * under-reporting costs the entire authorization model.
 */
export async function detectConnectionPosture(
    run: RawSqlRunner,
    schemas?: string[]
): Promise<ConnectionPosture> {
    // Identifiers, and they reach SQL as literals in a catalogue comparison —
    // but they arrive from collection configs, so they are quoted as string
    // literals rather than interpolated as names, and a quote inside one is
    // escaped rather than trusted.
    const schemaFilter = schemas?.length
        ? `AND n.nspname IN (${Array.from(new Set(schemas))
            .map((s) => `'${s.replace(/'/g, "''")}'`)
            .join(", ")})`
        : "";

    const rows = await run(`
        SELECT current_user            AS role,
               r.rolsuper              AS superuser,
               r.rolbypassrls          AS bypassrls,
               EXISTS (
                   SELECT 1 FROM pg_tables t
                   WHERE pg_has_role(current_user, t.tableowner, 'USAGE')
                     AND t.schemaname NOT IN ('pg_catalog', 'information_schema')
               )                       AS owns_tables,
               EXISTS (
                   SELECT 1 FROM pg_namespace n
                   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
                     AND n.nspname NOT LIKE 'pg\\_toast%'
                     AND n.nspname NOT LIKE 'pg\\_temp%'
                     ${schemaFilter}
                     AND has_schema_privilege(current_user, n.oid, 'CREATE')
               )                       AS can_create
        FROM pg_roles r
        WHERE r.rolname = current_user
    `);
    const row = rows[0] ?? {};
    const superuser = row.superuser === true;
    const bypassRLS = row.bypassrls === true;
    const ownsTables = row.owns_tables === true;
    const canCreateTables = row.can_create === true;
    return {
        role: String(row.role ?? "unknown"),
        superuser,
        bypassRLS,
        ownsTables,
        canCreateTables,
        privileged: superuser || bypassRLS || ownsTables || canCreateTables
    };
}

/**
 * The Postgres major from which a role membership carries a separate SET
 * option, as `server_version_num` spells it.
 *
 * From 16, `pg_has_role(…, 'MEMBER')` no longer answers "may this connection
 * `SET ROLE` to it": a membership can be held with `SET FALSE`. That is exactly
 * what a non-superuser with CREATEROLE gets for a role it creates — Postgres
 * records the creator as a member `WITH ADMIN TRUE, SET FALSE, INHERIT FALSE`
 * (unless `createrole_self_grant` says otherwise). RDS's master user, Cloud
 * SQL's `postgres`, Neon's owner and most managed "admin" users are that kind
 * of role. Asking MEMBER said yes, the grant was skipped, boot logged RLS as
 * active, and every signed-in request then failed with 42501 "permission
 * denied to set role". A plain `GRANT` on top changes nothing — Postgres reports
 * the membership as already granted — so the grant has to name the option.
 */
const SET_OPTION_SINCE = 160000;

/**
 * Raised when `rebase_user` cannot be provisioned, adopted or switched to —
 * with the SQL that fixes it in {@link instructions}.
 *
 * Its own class so a caller that prints the instructions itself (the CLI) can
 * tell they are already in the message.
 */
export class AppRoleSetupError extends Error {
    readonly instructions: string;

    constructor(problem: string, instructions: string) {
        super(`${problem}\n\n${instructions}`);
        this.name = "AppRoleSetupError";
        this.instructions = instructions;
    }
}

/**
 * What a failed statement said, without the statement.
 *
 * A Drizzle runner throws `Failed query: <sql>\nparams: <values>` and keeps
 * Postgres's own sentence in `.cause`. The logger redacts from that marker to
 * the next stack frame — the params have no terminator — so any text appended
 * after a Drizzle message is redacted with it. That is how the setup SQL below
 * used to vanish from a production log. Postgres's messages carry no statement
 * and no row values, and they are the part that says what is wrong.
 */
function failureReason(err: unknown): string {
    return extractCauseMessage(err) ?? (err instanceof Error ? err.message : String(err));
}

/**
 * The statement that lets `connectionRole` switch to the user role, as one
 * statement that works on any Postgres the driver supports.
 *
 * Version-adaptive rather than two alternatives for the reader to choose
 * between: `WITH SET TRUE` is a syntax error before 16, and a plain `GRANT`
 * from 16 on is a no-op on a membership that exists without SET.
 * `INHERIT FALSE` keeps the connection from picking up the user role's
 * privileges as its own; the switch is all it needs.
 */
function membershipGrantSql(connectionRole: string, role: string = REBASE_USER_ROLE): string {
    const member = sqlLiteral(connectionRole);
    const target = sqlLiteral(role);
    return (
        `DO $rebase_grant$\n` +
        `BEGIN\n` +
        `    IF current_setting('server_version_num')::int >= ${SET_OPTION_SINCE} THEN\n` +
        `        EXECUTE format('GRANT %I TO %I WITH SET TRUE, INHERIT FALSE', ${target}, ${member});\n` +
        `    ELSE\n` +
        `        EXECUTE format('GRANT %I TO %I', ${target}, ${member});\n` +
        `    END IF;\n` +
        `END\n` +
        `$rebase_grant$;`
    );
}

/**
 * Human-actionable instructions for when the connection cannot provision the
 * user role itself (no CREATEROLE and role not pre-created by the platform),
 * or holds it without the right to switch to it.
 *
 * Every statement is safe to re-run and the same text works on Postgres 15 and
 * 16+, so it can be pasted whole whatever state the database is in.
 * `connectionRole` is the role the server connects as; without one, a
 * placeholder Postgres will refuse until it is replaced.
 */
export function appRoleSetupInstructions(
    connectionRole: string | undefined,
    schemas: string[],
    role: string = REBASE_USER_ROLE,
    mode: GrantsMode = "schema"
): string {
    const member = connectionRole ?? "<your database user>";
    // The schema-wide grants are what the default mode makes; the other modes
    // grant table by table (`managed`) or not at all (`none`), and the
    // connection makes those itself once it may switch.
    const grants = mode !== "schema" ? "" : schemas.map((s) =>
        `GRANT USAGE ON SCHEMA ${quoteIdent(s)} TO ${role};\n` +
        `GRANT ${USER_TABLE_PRIVILEGES} ON ALL TABLES IN SCHEMA ${quoteIdent(s)} TO ${role};\n` +
        `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${quoteIdent(s)} TO ${role};`
    ).join("\n");
    return (
        `Rebase enforces row-level security by running authenticated requests as ` +
        `the restricted role "${role}", but the connection role ` +
        `"${member}" bypasses RLS and cannot set that role up itself.\n` +
        `Run the following as a database administrator (a superuser, or the role that created ` +
        `"${role}"), then restart:\n\n` +
        `DO $rebase_role$\n` +
        `BEGIN\n` +
        `    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${sqlLiteral(role)}) THEN\n` +
        `        CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;\n` +
        `    END IF;\n` +
        `END\n` +
        `$rebase_role$;\n` +
        `${membershipGrantSql(member, role)}\n` +
        grants
    );
}

/**
 * Refuse a `rebase_user` that would not restrict anything.
 *
 * The role is cluster-wide and found by name, so the one a boot adopts may
 * have been made by anybody — an earlier tool, a hand-written script, another
 * application on the same cluster. Every authenticated request runs as it, so
 * an attribute or a membership that lifts RLS lifts it from all of them, and
 * nothing would say so: requests succeed, with every row.
 *
 * - LOGIN: anyone holding its password connects as the request role directly.
 * - SUPERUSER, BYPASSRLS: RLS does not apply to it at all.
 * - A membership in a role that owns tables here, or is itself a login,
 *   superuser or BYPASSRLS role: a member inheriting an owner is the owner for
 *   every policy check, and one that may `SET ROLE` to a privileged role is a
 *   statement away from it. (`GRANT app TO rebase_user` for `GRANT rebase_user
 *   TO app` is the easy way to get here.)
 *
 * A plain NOLOGIN group role is left alone: `validatePolicyPgRoles` sends a
 * project with `pgRoles` to exactly that grant.
 */
export async function assertAppRoleRestricted(run: RawSqlRunner, role: string = REBASE_USER_ROLE): Promise<void> {
    const rows = await run(`
        SELECT r.rolcanlogin AS can_login,
               r.rolsuper AS superuser,
               r.rolbypassrls AS bypassrls,
               ARRAY(
                   SELECT g.rolname::text FROM pg_roles g
                   WHERE g.oid <> r.oid
                     AND pg_has_role(r.oid, g.oid, 'MEMBER')
                     AND (g.rolsuper OR g.rolbypassrls OR g.rolcanlogin
                          OR EXISTS (SELECT 1 FROM pg_class c
                                     WHERE c.relowner = g.oid AND c.relkind IN ('r', 'p', 'v', 'm', 'f')))
                   ORDER BY 1
               ) AS privileged_memberships
        FROM pg_roles r
        WHERE r.rolname = ${sqlLiteral(role)}
    `);
    const row = rows[0];
    if (!row) return;
    const memberships = textArrayValue(row.privileged_memberships);
    const problems: string[] = [];
    const fixes: string[] = [];
    const attributes: string[] = [];
    if (row.can_login === true) { problems.push("it can log in (LOGIN)"); attributes.push("NOLOGIN"); }
    if (row.superuser === true) { problems.push("it is a superuser, so RLS does not apply to it"); attributes.push("NOSUPERUSER"); }
    if (row.bypassrls === true) { problems.push("it has BYPASSRLS, so RLS does not apply to it"); attributes.push("NOBYPASSRLS"); }
    if (attributes.length > 0) fixes.push(`ALTER ROLE ${role} ${attributes.join(" ")};`);
    if (memberships.length > 0) {
        problems.push(
            `it is a member of ${memberships.map((m) => `"${m}"`).join(", ")} — a role that owns tables or ` +
            "logs in, or is a superuser or BYPASSRLS — so requests can act as that role"
        );
        for (const m of memberships) fixes.push(`REVOKE ${quoteIdent(m)} FROM ${role};`);
    }
    if (problems.length === 0) return;
    throw new AppRoleSetupError(
        `Refusing to use the existing "${role}" role: every authenticated request runs as it, ` +
        `and ${problems.join("; ")}. Row-level security would not restrict those requests.`,
        `Run the following as a database administrator, then restart. If another application on this ` +
        `cluster relies on "${role}" being this way, the two cannot share it.\n\n` +
        fixes.join("\n")
    );
}

/**
 * Prove the connection can switch to the user role, the way every request
 * will, and leave nothing behind.
 *
 * Catalogue answers are only a model of what Postgres will allow. This is the
 * switch itself — `set_config('role', …, true)` is what `applyAuthContext`
 * sends — followed, in the same statement, by switching back to the role the
 * session had, so nothing outlives the probe even when the runner is inside a
 * transaction of its own. A refusal escapes as Postgres's own 42501.
 *
 * Each step is its own subquery level, so the order is the plan's, not the
 * order of a target list: the innermost reads the role the session has, the
 * middle switches, the outer switches back. `OFFSET 0` keeps the levels from
 * being flattened, and a volatile column is never pruned as unused.
 *
 * A `SELECT`, not a `DO` block with a rolled-back subtransaction: the
 * provisioning recorder and the provisioning-off guard both read a leading
 * `DO` as a schema change, and this changes nothing.
 */
const roleSwitchProbe = (role: string): string => `
    SELECT set_config('role', switched.previous, true) AS restored
    FROM (
        SELECT session.previous, set_config('role', ${sqlLiteral(role)}, true) AS probe
        FROM (SELECT current_setting('role') AS previous OFFSET 0) session
        OFFSET 0
    ) switched
`;

/**
 * Run {@link roleSwitchProbe}, and on a refusal throw an
 * {@link AppRoleSetupError} carrying the SQL that grants the switch.
 *
 * For a boot that adopts the role without provisioning it as much as for one
 * that just did: either way the next thing that happens is a request running
 * as it.
 */
export async function proveRoleSwitch(
    run: RawSqlRunner,
    schemas: string[],
    connectionRole?: string,
    role: string = REBASE_USER_ROLE
): Promise<void> {
    try {
        await run(roleSwitchProbe(role));
    } catch (err) {
        const member = connectionRole ?? String((await run("SELECT current_user AS role").catch(() => []))[0]?.role ?? "");
        throw new AppRoleSetupError(
            `The connection role "${member}" cannot switch to "${role}", so every ` +
            `authenticated request would fail: ${failureReason(err)}`,
            appRoleSetupInstructions(member || undefined, Array.from(new Set(schemas.filter(Boolean))), role)
        );
    }
}

/** The `rebase.schema_meta` key that records which roles requests run as. */
export const REQUEST_ROLES_KEY = "request_roles";

/**
 * The request roles this database recorded on an earlier provisioning boot, or
 * `undefined` when none has — every database provisioned before the setting
 * existed, which ran as `rebase_user`.
 *
 * Recorded in the database rather than only configured because a role belongs
 * to the cluster and holds grants here: a later boot configured with another
 * name would provision a second role and leave the first one holding every
 * grant. Reading the record is how that boot notices.
 */
export async function readRecordedRequestRoles(run: RawSqlRunner): Promise<string[] | undefined> {
    const [present] = await run(`SELECT to_regclass('"${REBASE_SCHEMA}"."schema_meta"') IS NOT NULL AS present`);
    if (present?.present !== true) return undefined;
    const [row] = await run(`SELECT value FROM "${REBASE_SCHEMA}"."schema_meta" WHERE key = ${sqlLiteral(REQUEST_ROLES_KEY)}`);
    const value = row?.value === undefined ? "" : String(row.value).trim();
    return value === "" ? undefined : value.split(",").map((r) => r.trim()).filter(Boolean);
}

/**
 * Record `roles` as this database's request roles, creating `rebase.schema_meta`
 * if nothing has yet. The table is one of Rebase's internal tables, so it is
 * taken back from the request roles here, as its every creator does.
 */
export async function recordRequestRoles(run: RawSqlRunner, roles: readonly string[]): Promise<void> {
    // Checked first: `CREATE SCHEMA IF NOT EXISTS` asks for CREATE on the
    // database before it looks, and a connection without it would fail here
    // on a schema that is already there.
    const [schema] = await run(`SELECT to_regnamespace('${REBASE_SCHEMA}') IS NOT NULL AS present`);
    if (schema?.present !== true) await run(`CREATE SCHEMA IF NOT EXISTS "${REBASE_SCHEMA}"`);
    await run(`
        CREATE TABLE IF NOT EXISTS "${REBASE_SCHEMA}"."schema_meta" (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
        )
    `);
    await run(`
        INSERT INTO "${REBASE_SCHEMA}"."schema_meta" (key, value)
        VALUES (${sqlLiteral(REQUEST_ROLES_KEY)}, ${sqlLiteral(roles.join(","))})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
        WHERE "schema_meta".value IS DISTINCT FROM EXCLUDED.value
    `);
    await run(revokeInternalTableSql(REBASE_SCHEMA, "schema_meta"));
}

/**
 * Refuse a boot configured with request roles other than the ones this
 * database recorded. The same set in any order is the same.
 *
 * Nothing recorded means `rebase_user`, as every database from before the
 * setting ran — but only where `rebase_user` actually holds grants here. A
 * database it has never been granted on (a fresh one) has nothing to strand,
 * and a new role is simply recorded.
 */
export function assertRecordedRequestRoles(
    configured: readonly string[],
    recorded: readonly string[] | undefined,
    defaultRoleHoldsGrants: boolean
): void {
    if (!recorded && !defaultRoleHoldsGrants) return;
    const effective = recorded ?? [REBASE_USER_ROLE];
    const same = configured.length === effective.length && configured.every((r) => effective.includes(r));
    if (same) return;
    throw new AppRoleSetupError(
        `This database's requests run as ${effective.map((r) => `"${r}"`).join(", ")}` +
        `${recorded ? "" : " (the default, which holds grants here)"}, but this server is configured ` +
        `for ${configured.map((r) => `"${r}"`).join(", ")} (rls.requestRole / REBASE_RLS_REQUEST_ROLE). ` +
        "Booting would provision new roles and leave the old ones holding every grant.",
        "Move this database to the new role(s) — it re-creates each grant in this database only and records them:\n\n" +
        `  rebase db request-role migrate --to ${configured.join(",")}\n\n` +
        `Or set the setting back to ${effective.join(",")}.`
    );
}

/** Whether `role` holds any table privilege in `schemas` — something a new role would strand. */
export async function roleHoldsTableGrants(run: RawSqlRunner, schemas: readonly string[], role: string = REBASE_USER_ROLE): Promise<boolean> {
    const [row] = await run(`
        SELECT to_regrole(${sqlLiteral(role)}) IS NOT NULL AND EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = ANY(${textArray(schemas)}) AND c.relkind IN ('r', 'v', 'm', 'f', 'p')
              AND EXISTS (SELECT 1 FROM aclexplode(c.relacl) a WHERE a.grantee = to_regrole(${sqlLiteral(role)}))
        ) AS holds
    `);
    return row?.holds === true;
}

/**
 * Login roles other than this connection that can switch into `role`, and so
 * can pass this database's policies as whichever user they like: the settings the
 * policies read can be set by any session.
 *
 * Roles belong to the cluster, so this is how two projects on one cluster
 * sharing `rebase_user` shows up from inside either database. Superusers are
 * left out — they can become any role, and nothing here changes that.
 */
export async function findOtherRoleMembers(run: RawSqlRunner, role: string): Promise<string[]> {
    const rows = await run(`
        SELECT r.rolname AS name
        FROM pg_roles r
        WHERE r.rolcanlogin AND NOT r.rolsuper AND r.rolname <> current_user
          AND to_regrole(${sqlLiteral(role)}) IS NOT NULL
          AND pg_has_role(r.oid, to_regrole(${sqlLiteral(role)}),
                          CASE WHEN current_setting('server_version_num')::int >= ${SET_OPTION_SINCE} THEN 'SET' ELSE 'MEMBER' END)
        ORDER BY 1
    `);
    return rows.map((row) => String(row.name));
}

/** How {@link ensureAppRole} provisions: which role, and what it may create and grant. */
export interface EnsureAppRoleOptions {
    /** The request role. Default `rebase_user`. */
    role?: string;
    /** `"never"`: check the role and the membership, create neither. */
    provisionRole?: ProvisionRoleMode;
    /** What the grant tier grants — see {@link ensureAppRoleGrants}. */
    grants?: GrantsMode;
    /** The tables Rebase serves, for `grants: "managed"`. */
    managedTables?: readonly ManagedTable[];
    /** Roles granted to the request role `WITH INHERIT TRUE` (PostgreSQL 16+). */
    inheritRoles?: readonly string[];
}

/** A table Rebase serves, by schema and name. */
export interface ManagedTable {
    schema: string;
    table: string;
}

/**
 * Idempotently provision the `rebase_user` role, membership for the current
 * connection role, and DML grants (+ default privileges for future tables)
 * on every existing schema in `schemas`.
 *
 * Split into privilege tiers so it works both when the connection is a
 * superuser (creates everything) and when the platform pre-created the role
 * and membership (e.g. CNPG `postInitApplicationSQL`) and the connection is
 * merely the table owner — owners can always run the grant tier themselves.
 *
 * RLS still filters every row: these grants only make the tables *reachable*
 * by the role; the policies decide which rows/commands actually pass.
 *
 * Throws {@link AppRoleSetupError}, with precise setup instructions, when the
 * role is missing and the connection cannot create it, when an existing role
 * would not restrict anything, and when the connection cannot switch to it.
 * Boot fails then, rather than serving an API whose every signed-in request is
 * refused — or, worse, allowed.
 */
export async function ensureAppRole(run: RawSqlRunner, schemas: string[], options: EnsureAppRoleOptions = {}): Promise<void> {
    const uniqueSchemas = Array.from(new Set(schemas.filter(Boolean)));
    const role = options.role ?? REBASE_USER_ROLE;
    const provision = options.provisionRole !== "never";

    const [who] = await run(`
        SELECT current_user AS role,
               (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser,
               current_setting('server_version_num')::int >= ${SET_OPTION_SINCE} AS set_option,
               EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${sqlLiteral(role)}) AS role_exists
    `);
    const connectionRole = String(who?.role ?? "");
    const superuser = who?.superuser === true;
    const setOption = who?.set_option === true;
    const instructions = () => appRoleSetupInstructions(connectionRole || undefined, uniqueSchemas, role, options.grants);

    // Tier 1 — role existence, and a role found rather than made is checked
    // before anything is granted to it or runs as it.
    if (who?.role_exists !== true && !provision) {
        throw new AppRoleSetupError(
            `The request role "${role}" does not exist, and rls.provisionRole is "never", so Rebase does not create it.`,
            instructions()
        );
    }
    if (who?.role_exists !== true) {
        try {
            // Guarded in the statement as well as by the probe above. A role
            // belongs to the cluster, not the database, so a recorded
            // provisioning run (REBASE_PROVISION_SQL_OUT) replayed into another
            // database on a cluster that already has the role must find this a
            // no-op rather than its first error.
            await run(`
                DO $rebase_role$
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
                        CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
                    END IF;
                END
                $rebase_role$
            `);
        } catch (err) {
            throw new AppRoleSetupError(`Failed to create the "${role}" role: ${failureReason(err)}`, instructions());
        }
    } else {
        await assertAppRoleRestricted(run, role);
    }

    // Tier 2 — membership with the right to SET ROLE to it. A superuser needs
    // none. From 16 that right is its own option, and MEMBER alone is not it.
    if (!superuser) {
        const [membership] = await run(
            `SELECT pg_has_role(current_user, ${sqlLiteral(role)}, '${setOption ? "SET" : "MEMBER"}') AS can_set`
        );
        if (membership?.can_set !== true && !provision) {
            throw new AppRoleSetupError(
                `The connection role "${connectionRole}" may not switch to "${role}", and rls.provisionRole is ` +
                `"never", so Rebase does not grant itself that.`,
                instructions()
            );
        }
        if (membership?.can_set !== true) {
            try {
                await run(setOption
                    ? `GRANT ${role} TO CURRENT_USER WITH SET TRUE, INHERIT FALSE`
                    : `GRANT ${role} TO CURRENT_USER`);
            } catch (err) {
                throw new AppRoleSetupError(
                    `The connection role "${connectionRole}" may not switch to "${role}" ` +
                    `${setOption ? "(no membership WITH SET TRUE)" : "(not a member)"} and cannot grant that ` +
                    `to itself: ${failureReason(err)}`,
                    instructions()
                );
            }
        }
    }

    // Tier 2b — the switch itself. Without this the boot logged enforcement as
    // active on a connection Postgres would refuse on the first request.
    await proveRoleSwitch(run, uniqueSchemas, connectionRole || undefined, role);

    // Tier 2c — roles whose `TO` policies should apply to requests.
    if (options.inheritRoles?.length) await ensureInheritedRoles(run, role, options.inheritRoles);

    // Tier 3 — grants.
    await ensureAppRoleGrants(run, uniqueSchemas, { role, mode: options.grants, managedTables: options.managedTables });

    logger.debug(`🔐 [rls] User role "${role}" provisioned (schemas: ${uniqueSchemas.join(", ")})`);
}

/**
 * The framework's internal tables in `schemas` that the request role can
 * reach — `schema.table`, sorted — when nothing is left to take it back off.
 *
 * Every provisioning boot repairs this: each store revokes on its own table
 * and {@link ensureAppRole}'s sweep revokes on the rest, because the grant
 * tier hands the request role DML on whole schemas. A backend that changes
 * nothing in its database runs neither, so a database whose `rebase_user` can
 * read `refresh_tokens` or `api_keys` would stay that way for as long as it
 * served. This is the question the sweep would have answered, asked instead.
 *
 * "Can reach" is what the role can actually do — through a grant to it, to a
 * role it inherits, or to PUBLIC, on the table or on any of its columns —
 * because that, not how the ACL is spelled, is what a request running as it
 * gets. A table with RLS on is somebody's collection by that same rule as the
 * sweep's, and is left out.
 */
export async function findExposedInternalTables(run: RawSqlRunner, schemas: string[], role: string = REBASE_USER_ROLE): Promise<string[]> {
    const rows = await run(`
        SELECT n.nspname || '.' || c.relname AS name
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ANY(${textArray(Array.from(new Set(schemas)))})
          AND c.relname = ANY(${textArray(REBASE_INTERNAL_TABLES)})
          AND c.relkind IN ('r', 'p')
          AND NOT c.relrowsecurity
          AND (has_table_privilege(${sqlLiteral(role)}, c.oid, 'SELECT, INSERT, UPDATE, DELETE')
               OR has_any_column_privilege(${sqlLiteral(role)}, c.oid, 'SELECT, INSERT, UPDATE'))
        ORDER BY 1
    `);
    return rows.map(row => String(row.name));
}

/** The connection role's oid, for a catalogue read. */
const CURRENT_ROLE_OID = "(SELECT oid FROM pg_roles WHERE rolname = current_user)";

/**
 * SQL: may this connection grant every one of `privileges` on an object?
 *
 * Its owner, a role that inherits the owner, or a superuser — `pg_has_role`
 * answers yes for all three — or a role holding each privilege `WITH GRANT
 * OPTION`. Every one, because a grant short of one only warns and leaves the
 * object reading as missing, which is the boot-after-boot re-grant this exists
 * to stop.
 */
function mayGrant(kind: "schema" | "table" | "sequence", oid: string, owner: string, privileges: readonly string[]): string {
    const withGrantOption = privileges
        .map((p) => `has_${kind}_privilege(current_user, ${oid}, ${sqlLiteral(`${p} WITH GRANT OPTION`)})`)
        .join(" AND ");
    return `(pg_has_role(current_user, ${owner}, 'USAGE') OR (${withGrantOption}))`;
}

/**
 * Tables collections are served from that the user role holds no privilege on
 * and this connection cannot grant it, because another role owns them.
 *
 * The grant tier passes these over — it could only fail on them — so on a
 * database another application shares, a collection over that application's
 * table boots and then refuses every request with "permission denied". This
 * names them, with the owner who can run the grant. Refusing rather than
 * widening, so the boot warns instead of stopping: the rest of the project
 * works, and an introspected project serves every table in the schema,
 * whoever owns it.
 */
export async function findUngrantableTables(
    run: RawSqlRunner,
    tables: readonly ManagedTable[],
    role: string = REBASE_USER_ROLE
): Promise<{ name: string; owner: string; grant: string }[]> {
    if (tables.length === 0) return [];
    const rows = await run(`
        SELECT n.nspname AS schema, c.relname AS table, pg_get_userbyid(c.relowner) AS owner
        FROM unnest(${textArray(tables.map((t) => t.schema))}, ${textArray(tables.map((t) => t.table))}) AS w(s, t)
        JOIN pg_namespace n ON n.nspname = w.s
        JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = w.t
        WHERE NOT ${mayGrant("table", "c.oid", "c.relowner", USER_TABLE_PRIVILEGES.split(", "))}
          AND NOT has_table_privilege(to_regrole(${sqlLiteral(role)}), c.oid, 'SELECT, INSERT, UPDATE, DELETE')
        ORDER BY 1, 2
    `);
    return rows.map((row) => {
        const name = `${quoteIdent(String(row.schema))}.${quoteIdent(String(row.table))}`;
        return { name, owner: String(row.owner), grant: `GRANT ${USER_TABLE_PRIVILEGES} ON ${name} TO ${role};` };
    });
}

/** What the grant tier would find already in place in one schema. */
interface SchemaGrants {
    /** `USAGE` on the schema, granted by its owner — or nothing this connection could grant. */
    usage: boolean;
    /**
     * Relations (`GRANT … ON ALL TABLES` reaches the same kinds) still missing
     * one of the four DML privileges from their owner, among those this
     * connection may grant on. Rebase's own RLS-off tables are left out: they
     * are never to have them.
     *
     * Only the grantable ones, because the rest can never be completed from
     * here. A shared `public` holding another application's table used to make
     * this "missing" forever: every boot re-ran a schema-wide grant that
     * Postgres refused for that table, with an error that aborted boot or a
     * warning that came back on the next one.
     */
    tables: string[];
    /** Sequences still missing `USAGE, SELECT` from their owner, among those this connection may grant on. */
    sequences: string[];
    /** This role's default privileges in the schema already grant the table DML. */
    defaultTables: boolean;
    /** …and the sequence `USAGE, SELECT`. */
    defaultSequences: boolean;
    /**
     * Rebase's own RLS-off tables a `REVOKE` would still change: the user role
     * holds a privilege on them, or the table has never had an ACL written —
     * `NULL`, which a `REVOKE` (like the grant-and-revoke it replaces) turns
     * into the owner's explicit default. Same access either way; the same
     * catalogue only this way.
     */
    internalGranted: string[];
    /**
     * The stored rows of materialized-view collections (`view-names.ts`) the
     * user role holds a privilege on. Only the owner may read them; the
     * schema-wide grant hands them out like any relation, so they are taken
     * back after it.
     */
    viewRowsGranted: string[];
}

/**
 * The grant tier's state for every existing schema in `schemas`, in one read.
 *
 * A grant counts as present only as the statement this tier runs would record
 * it — grantor the object's owner, which is what a GRANT by the owner, a member
 * of the owning role or a superuser records, or this connection itself, which
 * is what a GRANT on its grant option records — so skipping it leaves the ACL
 * exactly as running it would. Anything else reads as missing, and the
 * statement runs as it always did.
 */
async function readSchemaGrants(
    run: RawSqlRunner,
    schemas: string[],
    role: string = REBASE_USER_ROLE,
    managedTables?: readonly ManagedTable[]
): Promise<Map<string, SchemaGrants>> {
    // `grants: "managed"`: only the tables Rebase serves, and the sequences
    // those tables own (serial and identity columns).
    const managed = managedTables
        ? `(SELECT * FROM unnest(${textArray(managedTables.map((t) => t.schema))}, ${textArray(managedTables.map((t) => t.table))}))`
        : undefined;
    const onlyManagedTables = managed ? `AND (n.nspname, c.relname::text) IN ${managed}` : "";
    const onlyManagedSequences = managed
        ? `AND EXISTS (SELECT 1 FROM pg_depend d JOIN pg_class t ON t.oid = d.refobjid
                       WHERE d.objid = c.oid AND d.deptype IN ('a', 'i')
                         AND (n.nspname, t.relname::text) IN ${managed})`
        : "";
    const internal = textArray(REBASE_INTERNAL_TABLES);
    const target = `(SELECT oid FROM pg_roles WHERE rolname = ${sqlLiteral(role)})`;
    /** Distinct privileges `acl` gives the user role (from `grantor`, when given) out of `privileges`. */
    const held = (acl: string, privileges: string[], grantor?: string): string =>
        `(SELECT count(DISTINCT a.privilege_type) FROM aclexplode(${acl}) a WHERE a.grantee = ${target}` +
        `${grantor ? ` AND a.grantor IN (${grantor}, ${CURRENT_ROLE_OID})` : ""} AND a.privilege_type IN (${privileges.map(sqlLiteral).join(", ")}))`;
    const DML = ["SELECT", "INSERT", "UPDATE", "DELETE"];
    const SEQ = ["USAGE", "SELECT"];
    const viewRows = (alias: string): string =>
        `(${alias}.relkind = 'm' AND COALESCE(obj_description(${alias}.oid, 'pg_class'), '') LIKE '${VIEW_ROWS_COMMENT_PREFIX}%')`;
    const rows = await run(`
        SELECT n.nspname AS schema,
               -- Settled as well when this connection cannot grant it: a schema
               -- another role owns (a shared database's \`public\`) only warned,
               -- and was re-granted on every boot. PUBLIC's own USAGE covers it there.
               (${held("n.nspacl", ["USAGE"], "n.nspowner")} = 1
                OR NOT ${mayGrant("schema", "n.oid", "n.nspowner", ["USAGE"])}) AS usage,
               ARRAY(
                   SELECT c.relname::text FROM pg_class c
                   WHERE c.relnamespace = n.oid AND c.relkind IN ('r', 'v', 'm', 'f', 'p')
                     AND NOT (c.relname = ANY(${internal}) AND NOT c.relrowsecurity)
                     AND ${mayGrant("table", "c.oid", "c.relowner", DML)}
                     ${onlyManagedTables}
                     AND NOT ${viewRows("c")}
                     AND ${held("c.relacl", DML, "c.relowner")} < ${DML.length}
                   ORDER BY 1
               ) AS tables,
               ARRAY(
                   SELECT c.relname::text FROM pg_class c
                   WHERE c.relnamespace = n.oid AND c.relkind = 'S'
                     AND ${mayGrant("sequence", "c.oid", "c.relowner", SEQ)}
                     ${onlyManagedSequences}
                     AND ${held("c.relacl", SEQ, "c.relowner")} < ${SEQ.length}
                   ORDER BY 1
               ) AS sequences,
               EXISTS (
                   SELECT 1 FROM pg_default_acl d
                   WHERE d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = current_user)
                     AND d.defaclnamespace = n.oid AND d.defaclobjtype = 'r'
                     AND ${held("d.defaclacl", DML)} = ${DML.length}
               ) AS default_tables,
               EXISTS (
                   SELECT 1 FROM pg_default_acl d
                   WHERE d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = current_user)
                     AND d.defaclnamespace = n.oid AND d.defaclobjtype = 'S'
                     AND ${held("d.defaclacl", SEQ)} = ${SEQ.length}
               ) AS default_sequences,
               ARRAY(
                   SELECT c.relname::text FROM pg_class c
                   WHERE c.relnamespace = n.oid AND c.relname = ANY(${internal}) AND NOT c.relrowsecurity
                     AND (c.relacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(c.relacl) a WHERE a.grantee = ${target}))
                   ORDER BY 1
               ) AS internal_granted,
               ARRAY(
                   SELECT c.relname::text FROM pg_class c
                   WHERE c.relnamespace = n.oid AND ${viewRows("c")}
                     AND EXISTS (SELECT 1 FROM aclexplode(c.relacl) a WHERE a.grantee = ${target})
                   ORDER BY 1
               ) AS view_rows_granted
        FROM pg_namespace n
        WHERE n.nspname = ANY(${textArray(schemas)})
    `);
    const grants = new Map<string, SchemaGrants>();
    for (const row of rows) {
        const internalGranted = row.internal_granted;
        const viewRowsGranted = row.view_rows_granted;
        grants.set(String(row.schema), {
            usage: row.usage === true,
            tables: textArrayValue(row.tables),
            sequences: textArrayValue(row.sequences),
            defaultTables: row.default_tables === true,
            defaultSequences: row.default_sequences === true,
            internalGranted: textArrayValue(internalGranted),
            viewRowsGranted: textArrayValue(viewRowsGranted)
        });
    }
    return grants;
}

/** What {@link ensureAppRoleGrants} grants, and to whom. */
export interface AppRoleGrantOptions {
    /** The request role. Default `rebase_user`. */
    role?: string;
    /**
     * `"schema"` (default): every table and sequence in the schemas that this
     * connection may grant on, and default privileges for later ones.
     * `"managed"`: only {@link managedTables} and the sequences they own, no
     * default privileges. `"none"`: nothing, not even the revoke sweep.
     */
    mode?: GrantsMode;
    managedTables?: readonly ManagedTable[];
}

/**
 * Grant each of `inheritRoles` to the request role `WITH INHERIT TRUE`, so a
 * policy written `TO` one of them — Supabase's `authenticated`, say — applies
 * to requests.
 *
 * PostgreSQL 16 and newer only. From 16 inheritance is an option of each
 * grant, so the request role takes on these roles' privileges and stays
 * NOINHERIT towards every other membership. Before 16 the only lever is the
 * role's own INHERIT attribute, which would hand it every role it belongs to;
 * that is refused rather than done.
 */
export async function ensureInheritedRoles(run: RawSqlRunner, role: string, inheritRoles: readonly string[]): Promise<void> {
    const [server] = await run(`SELECT current_setting('server_version_num')::int >= ${SET_OPTION_SINCE} AS per_grant`);
    if (server?.per_grant !== true) {
        throw new AppRoleSetupError(
            `rls.inheritRoles (${inheritRoles.join(", ")}) needs PostgreSQL 16 or newer: before 16 the request role ` +
            `"${role}" can only inherit by inheriting from every role it belongs to.`,
            "Upgrade to PostgreSQL 16+, or drop rls.inheritRoles and express those policies as the collection's securityRules."
        );
    }
    const rows = await run(`
        SELECT w.name, r.oid IS NOT NULL AS present,
               COALESCE(pg_has_role(to_regrole(${sqlLiteral(role)}), r.oid, 'USAGE'), false) AS inherits
        FROM unnest(${textArray(inheritRoles)}) AS w(name)
        LEFT JOIN pg_roles r ON r.rolname = w.name
    `);
    const missing = rows.filter((row) => row.present !== true).map((row) => String(row.name));
    if (missing.length > 0) {
        throw new AppRoleSetupError(
            `rls.inheritRoles names ${missing.map((m) => `"${m}"`).join(", ")}, which ${missing.length === 1 ? "does" : "do"} not exist in this cluster.`,
            "Create the role(s), or remove them from rls.inheritRoles."
        );
    }
    for (const row of rows) {
        if (row.inherits === true) continue;
        const name = String(row.name);
        const grant = `GRANT ${quoteIdent(name)} TO ${quoteIdent(role)} WITH INHERIT TRUE, SET FALSE`;
        try {
            await run(grant);
        } catch (err) {
            throw new AppRoleSetupError(
                `Could not grant "${name}" to the request role "${role}" for rls.inheritRoles: ${failureReason(err)}`,
                `Run as a database administrator, then restart:\n\n${grant};`
            );
        }
    }
}

/**
 * Provision the role admin requests run as for one request role:
 * `<role>_admin`, inheriting `role` — its grants, and every policy written
 * for it — and {@link REBASE_ADMIN_ROLE}, with the connection able to switch
 * to it. The role itself goes through {@link ensureAppRole} (created NOLOGIN
 * NOSUPERUSER NOBYPASSRLS, checked as restricted when found, the switch
 * proved), with no grants of its own: everything it can reach, it reaches as
 * `role` does.
 *
 * Inheriting is per grant from PostgreSQL 16 (`WITH INHERIT TRUE`); before
 * that it is the role's own `INHERIT` attribute, harmless here because this
 * role belongs to exactly the two roles granted below.
 */
export async function ensureAdminRequestRole(
    run: RawSqlRunner,
    schemas: string[],
    options: { role: string; adminRole: string; provisionRole?: ProvisionRoleMode }
): Promise<void> {
    const { role, adminRole } = options;
    const provision = options.provisionRole !== "never";
    const [present] = await run(`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${REBASE_ADMIN_ROLE}') AS present`);
    if (present?.present !== true) {
        if (!provision) {
            throw new AppRoleSetupError(
                `The role "${REBASE_ADMIN_ROLE}" does not exist, and rls.provisionRole is "never", so Rebase does not create it.`,
                `Run as a database administrator, then restart:\n\nCREATE ROLE ${REBASE_ADMIN_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;`
            );
        }
        await run(ADMIN_POLICY_ROLE_SQL);
    }

    await ensureAppRole(run, schemas, { role: adminRole, provisionRole: options.provisionRole, grants: "none" });

    const [state] = await run(`
        SELECT current_setting('server_version_num')::int >= ${SET_OPTION_SINCE} AS per_grant,
               r.rolinherit AS inherits_all,
               pg_has_role(r.oid, to_regrole(${sqlLiteral(role)}), 'USAGE') AS has_request_role,
               pg_has_role(r.oid, to_regrole('${REBASE_ADMIN_ROLE}'), 'USAGE') AS has_admin_role
        FROM pg_roles r WHERE r.rolname = ${sqlLiteral(adminRole)}
    `);
    const perGrant = state?.per_grant === true;
    const missing = [
        ...(state?.has_request_role === true ? [] : [role]),
        ...(state?.has_admin_role === true ? [] : [REBASE_ADMIN_ROLE])
    ];
    if (missing.length === 0) return;
    const statements = [
        ...(!perGrant && state?.inherits_all !== true ? [`ALTER ROLE ${adminRole} INHERIT`] : []),
        ...missing.map((granted) => perGrant
            ? `GRANT ${quoteIdent(granted)} TO ${adminRole} WITH INHERIT TRUE, SET FALSE`
            : `GRANT ${quoteIdent(granted)} TO ${adminRole}`)
    ];
    const instructions = `Run as a database administrator, then restart:\n\n${statements.map((st) => `${st};`).join("\n")}`;
    if (!provision) {
        throw new AppRoleSetupError(
            `The admin request role "${adminRole}" does not inherit ${missing.map((m) => `"${m}"`).join(" and ")}, and ` +
            "rls.provisionRole is \"never\", so Rebase does not grant it.",
            instructions
        );
    }
    try {
        for (const statement of statements) await run(statement);
    } catch (err) {
        throw new AppRoleSetupError(
            `Could not let the admin request role "${adminRole}" inherit ${missing.map((m) => `"${m}"`).join(" and ")}: ${failureReason(err)}`,
            instructions
        );
    }
}

/**
 * Let the connection role itself pass the server-or-admin policies, by
 * inheriting {@link REBASE_ADMIN_ROLE} — which is what `TO public` gave it.
 *
 * It matters where the connection is subject to RLS: always, when it owns
 * none of the tables (requests then run as the connection itself, so the
 * server context and admins depend on it), and on any table it does not own
 * otherwise. Best effort: a connection that cannot be granted the role is
 * told what to run, and its server-context and admin reads of those tables are
 * refused — closed, never wider — until someone does.
 */
export async function ensureConnectionInheritsAdminRole(run: RawSqlRunner, options: { provision: boolean }): Promise<void> {
    const [state] = await run(`
        SELECT current_user AS role,
               (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) AS exempt,
               current_setting('server_version_num')::int >= ${SET_OPTION_SINCE} AS per_grant,
               to_regrole('${REBASE_ADMIN_ROLE}') IS NOT NULL AS present,
               COALESCE(pg_has_role(current_user, to_regrole('${REBASE_ADMIN_ROLE}'), 'USAGE'), false) AS inherits
    `);
    if (state?.exempt === true || state?.inherits === true) return;
    const connection = String(state?.role ?? "");
    const grant = state?.per_grant === true
        ? `GRANT ${REBASE_ADMIN_ROLE} TO ${quoteIdent(connection)} WITH INHERIT TRUE, SET FALSE`
        : `GRANT ${REBASE_ADMIN_ROLE} TO ${quoteIdent(connection)}`;
    // Only once the role exists can a policy be written TO it; until then the
    // policies step keeps them TO public, and there is nothing to refuse.
    const warn = (why: string, roleExists: boolean) => (roleExists ? (m: string) => logger.warn(m) : (m: string) => logger.debug(m))(
        `⚠️ RLS enforcement: the connection role "${connection}" does not inherit "${REBASE_ADMIN_ROLE}" (${why}), ` +
        "so on any table it does not own, its server-context and admin requests do not pass the server-or-admin " +
        `policies and are refused. Run as an administrator: ${roleExists ? "" : `CREATE ROLE ${REBASE_ADMIN_ROLE} NOLOGIN; `}${grant}; ` +
        "— or declare rls.adminPolicies \"public\"."
    );
    if (!options.provision) {
        warn("this driver was opened without provisioning", state?.present === true);
        return;
    }
    let roleExists = state?.present === true;
    try {
        if (!roleExists) await run(ADMIN_POLICY_ROLE_SQL);
        roleExists = true;
        await run(grant);
    } catch (err) {
        warn(failureReason(err), roleExists);
    }
}

/**
 * The request identity a boot hands the driver and the realtime refetch, with
 * the admin switch on when every admin request role is ready: provisioned
 * here, or — on a boot that provisions nothing — found existing, inheriting
 * what it should and switchable. Otherwise admin requests run as the request
 * role, as before, and the boot says why: under `adminPolicies: "adminRole"`,
 * policies already written `TO rebase_admin` then refuse them.
 */
export async function settleAdminRequestRoles(
    run: RawSqlRunner,
    schemas: string[],
    settings: RlsSettings,
    options: { provision: boolean }
): Promise<RequestIdentity> {
    if (settings.adminRoles.size === 0) return settings.request;
    const failures: string[] = [];
    for (const [role, adminRole] of settings.adminRoles) {
        try {
            // A boot that provisions nothing only checks: "never" creates and
            // grants nothing, and refuses what is not already there.
            await ensureAdminRequestRole(run, schemas, {
                role, adminRole, provisionRole: options.provision ? settings.provisionRole : "never"
            });
        } catch (err) {
            failures.push(`"${adminRole}": ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    if (failures.length > 0) {
        // Without `rebase_admin` the policies step writes the server-or-admin
        // policies TO public, which the request role passes: as before, and
        // nothing refused. With it, those policies refuse admins until fixed.
        const [marker] = await run(`SELECT to_regrole('${REBASE_ADMIN_ROLE}') IS NOT NULL AS present`);
        (marker?.present === true ? (m: string) => logger.warn(m) : (m: string) => logger.info(m))(
            `${marker?.present === true ? "⚠️" : "🔐"} RLS enforcement: admin requests keep running as the request role, because ${failures.join("; ")}. ` +
            (marker?.present === true
                ? `Policies written TO ${REBASE_ADMIN_ROLE} (rls.adminPolicies "adminRole") do not apply to them until ` +
                  "this is fixed; declare adminPolicies \"public\" to write those policies TO public instead."
                : `The server-or-admin policies stay TO public here, so signed-in users' owner-scoped reads cannot use ` +
                  `the owner index. Create ${REBASE_ADMIN_ROLE} and the admin request role to change that, or declare ` +
                  "adminPolicies \"public\" to say this on purpose.")
        );
        return settings.request;
    }
    const adminRoles = settings.adminRoles;
    return { ...settings.request, adminRoleFor: (role) => adminRoles.get(role) };
}

/**
 * The grant tier of {@link ensureAppRole} on its own: `USAGE` on each existing
 * schema in `schemas`, DML on its tables and `USAGE, SELECT` on its
 * sequences, the default privileges that cover what this role creates later,
 * and Rebase's own tables taken back — for a role and membership already
 * provisioned.
 *
 * Every statement is issued only when the catalogue says it would change
 * something. They used to run unconditionally, twice per boot (at connect, and
 * again in the final posture check): a `GRANT … ON ALL TABLES` rewrites every
 * table's `pg_class` row whether or not the ACL changes, which invalidates
 * every table's cached plans on every connection, and the internal-table sweep
 * ran 23 `REVOKE`s per schema. A boot against a database whose grants already
 * hold now reads one catalogue query and writes nothing.
 *
 * Tables and sequences are granted by name, the ones that are missing it and
 * that this connection may grant on — not `ON ALL … IN SCHEMA`, which also
 * tries every relation another role owns. On a schema shared with another
 * application that statement fails for a table this connection holds no
 * privilege on, or only warns for one it holds without grant option, and either
 * way the schema never reads as granted. The ACLs this leaves are the ones the
 * schema-wide statement left on everything it could reach.
 *
 * Table owners (the expected non-superuser posture) can always grant on their
 * own objects, so this needs no extra privilege.
 */
export async function ensureAppRoleGrants(run: RawSqlRunner, schemas: string[], options: AppRoleGrantOptions = {}): Promise<void> {
    const role = options.role ?? REBASE_USER_ROLE;
    const mode = options.mode ?? "schema";
    // `none`: grants are the operator's, and so are revokes — nothing here.
    if (mode === "none") return;
    const uniqueSchemas = Array.from(new Set(schemas.filter(Boolean)));
    const grants = await readSchemaGrants(run, uniqueSchemas, role, mode === "managed" ? options.managedTables ?? [] : undefined);
    for (const schema of uniqueSchemas) {
        const state = grants.get(schema);
        // Not there (yet): a later call, once provisioning has created it, grants it.
        if (!state) continue;
        const s = quoteIdent(schema);
        if (!state.usage) await run(`GRANT USAGE ON SCHEMA ${s} TO ${role}`);
        const named = (relations: string[]) => relations.map((r) => `${s}.${quoteIdent(r)}`).join(", ");
        if (state.tables.length > 0) {
            await run(`GRANT ${USER_TABLE_PRIVILEGES} ON TABLE ${named(state.tables)} TO ${role}`);
        }
        if (state.sequences.length > 0) {
            await run(`GRANT USAGE, SELECT ON SEQUENCE ${named(state.sequences)} TO ${role}`);
        }
        // The stored rows of a materialized-view collection are the owner's
        // alone (`view-names.ts`). The grants above name them out; a default
        // privilege, or the schema-wide grant an older release ran, did not.
        for (const rows of state.viewRowsGranted) await run(`REVOKE ALL ON ${s}.${quoteIdent(rows)} FROM ${role}`);
        // Cover objects created later by the CURRENT role (the role that runs
        // migrations), so a migrate can never strand the user role. Not in
        // `managed`: a default privilege cannot tell Rebase's next table from
        // anybody else's.
        if (!state.defaultTables && mode === "schema") {
            await run(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} GRANT ${USER_TABLE_PRIVILEGES} ON TABLES TO ${role}`);
        }
        if (!state.defaultSequences && mode === "schema") {
            await run(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} GRANT USAGE, SELECT ON SEQUENCES TO ${role}`);
        }

        // The grants above deliberately cover the whole schema — a project's own
        // collections may live in `rebase`, and future tables must be reachable
        // or a migration strands the role. Rebase's OWN tables are the exception:
        // refresh tokens, MFA secrets, API keys and the rest carry no RLS and no
        // row an end user should ever address. The grant above leaves them out;
        // taking back what someone else gave them covers every table that
        // already exists, and each creator revokes on the table it just made,
        // for the boot that creates them for the first time.
        if (state.internalGranted.length === 0) continue;
        await revokeInternalTableAccess(async (text) => { await run(text); }, schema, {
            tables: state.internalGranted,
            onError: (table, error) => logger.warn(
                `🔐 [rls] Could not revoke "${role}" access to "${schema}"."${table}" — ` +
                "it stays reachable by authenticated requests: " +
                (error instanceof Error ? error.message : String(error))
            )
        });
    }
}

/**
 * Rebase's own RLS-off tables in `schema` that a `revokeInternalTableAccess`
 * sweep would change — the user role holds a privilege on them, or their ACL
 * has never been written. One read; the sweep it narrows is one `DO` per
 * table name.
 */
export async function internalTablesGrantedToUserRole(run: RawSqlRunner, schema: string, role: string = REBASE_USER_ROLE): Promise<string[]> {
    return (await readSchemaGrants(run, [schema], role)).get(schema)?.internalGranted ?? [];
}

/**
 * Apply the authenticated context to a transaction: the `app.*` GUCs that RLS
 * policies read via `rebase.uid()` / `rebase.roles()` / `rebase.jwt()`, and — when
 * `userRole` is set — the `LOCAL` role switch, in the same statement, so RLS
 * binds every statement in this transaction (reads *and* writes).
 *
 * GUCs are set with `is_local = true` and the role switch is `LOCAL`: both
 * reset at commit/rollback, so pooled connections are never polluted.
 *
 * Fails closed by construction: if the role switch errors, the transaction
 * aborts instead of proceeding privileged.
 *
 * SECURITY: this function is only ever called on the **user** path (the server
 * context uses the base/owner driver and never calls it). The default policies
 * treat `rebase.uid() IS NULL` as the trusted server context, and `rebase.uid()`
 * is `NULLIF(current_setting('app.uid'), '')` — so an EMPTY user id would
 * be read as NULL and silently escalate a user request to server privileges.
 * Coerce empty/blank ids to `ANONYMOUS_USER_ID` here, at the single chokepoint,
 * rather than trusting every caller (e.g. realtime subscription auth) to do it.
 * That sentinel is exported from `@rebasepro/types` because it leaks into rule
 * semantics: it is why `rebase.uid() IS NOT NULL` is true for anonymous requests.
 */
export async function applyAuthContext(tx: SqlTx, auth: AuthContext, userRole?: string | RequestIdentity): Promise<void> {
    const settings = authContextSettings(auth, userRole);
    await tx.execute(drizzleSql`SELECT ${drizzleSql.join(
        settings.map(([name, value]) => drizzleSql`${drizzleSql.raw(`set_config(${settingNameLiteral(name)}, `)}${value}, true)`),
        drizzleSql`, `
    )}`);
}

/**
 * {@link applyAuthContext} as one statement and its values, for a transaction
 * that sends it in the same batch as its first query
 * (`pipelined-transaction.ts`). `before` are settings of the transaction's own
 * — what a pooled connection could not carry at connect — set ahead of the
 * caller's, in the same statement.
 */
export function authContextStatement(
    auth: AuthContext,
    userRole?: string | RequestIdentity,
    before: readonly (readonly [string, string])[] = []
): { text: string; values: string[] } {
    const settings = [...before, ...authContextSettings(auth, userRole)];
    return {
        text: `SELECT ${settings.map(([name], i) => `set_config(${settingNameLiteral(name)}, $${i + 1}, true)`).join(", ")}`,
        values: settings.map(([, value]) => value)
    };
}

/**
 * A setting's name as a SQL literal. Names are this module's constants (and
 * the pooled settings' two), never a caller's value, which is a bound
 * parameter; written into the text so a statement log reads as the settings
 * it sets.
 */
function settingNameLiteral(name: string): string {
    return `'${name.replace(/'/g, "''")}'`;
}

/**
 * The transaction-local settings that make a transaction the caller's, in the
 * order they are set: the `app.*` GUCs, then the role.
 *
 * `userRole` is the role to switch to — or, for a project whose requests do not
 * all run as one role or carry their identity in more than `app.*`, the
 * resolved `rls` settings ({@link RequestIdentity}), which choose the role for
 * this caller and add their own settings ahead of the switch.
 */
function authContextSettings(auth: AuthContext, userRole?: string | RequestIdentity): [string, string][] {
    const uid = typeof auth.uid === "string" && auth.uid.trim() !== "" ? auth.uid : ANONYMOUS_USER_ID;
    const normalizedRoles = auth.roles.map((r: unknown) =>
        typeof r === "string" ? r : (r as Record<string, unknown>)?.id ?? String(r)
    );
    // `app.user_id` is the pre-rename spelling, still written because policies
    // are data: a database provisioned before the rename holds rules compiled
    // to `current_setting('app.user_id')`, and those predicates would evaluate
    // to NULL — failing open or locking out — if we stopped setting it. Drop
    // the alias only once no live database carries a legacy policy.
    // A guest is a signed-in caller with no account behind them, and until this
    // the database could not tell the difference — see `rebase.is_anonymous()`.
    // Written as a string because that is what `set_config` takes.
    const isAnonymous = auth.isAnonymous === true ? "true" : "false";

    const settings: [string, string][] = [
        ["app.uid", uid],
        ["app.user_id", uid],
        ["app.user_roles", normalizedRoles.join(",")],
        ["app.is_anonymous", isAnonymous],
        ["app.jwt", JSON.stringify({
            // The caller's custom claims, FIRST, so the identity keys below
            // overwrite them rather than the other way round. Same ordering, and
            // the same reason, as `generateAccessToken`: a claims hook is a place
            // to add facts about a session, not the place its subject is decided.
            // `verifyAccessToken` already strips the identity claims out of this
            // object; the ordering is the second lock on the same door.
            ...(auth.claims ?? {}),
            sub: uid,
            roles: auth.roles,
            // In the claims too, so a policy reading `rebase.jwt()` — which is
            // how a rule reaches anything that is not uid or roles — sees the
            // same fact as `rebase.is_anonymous()`. Two sources that could
            // disagree would be worse than one.
            is_anonymous: auth.isAnonymous === true
        })]
    ];
    // The role switch, in the same statement rather than a `SET LOCAL ROLE`
    // round trip of its own on every transaction. Postgres implements
    // `SET ROLE` as the `role` setting: `set_config('role', name, true)`
    // runs the same membership check, fails with the same SQLSTATE and
    // message (42501 "permission denied to set role", 22023 for an unknown
    // role — `isRoleSwitchingPermissionError` still reads it), takes the
    // name verbatim as the quoted identifier did, and resets at COMMIT and
    // ROLLBACK like `LOCAL`. Last in the list, after the GUCs; a refusal
    // fails the whole statement, so the transaction aborts rather than
    // running on as the connection owner. auth-context-one-statement.test.ts.
    const role = typeof userRole === "object" ? userRole.roleFor(auth) : userRole;
    // Another convention's identity settings (`rls.identity`), after Rebase's
    // own and before the switch, so the switch stays last.
    if (typeof userRole === "object" && role) {
        for (const [name, value] of userRole.settingsFor(auth, role)) settings.push([name, value]);
    }
    // A caller the `admin` arm of a policy would pass runs as the role that
    // inherits `rebase_admin`, the only role the server-or-admin policies apply
    // to (`adminPolicies: "adminRole"`). Decided from the same comma-joined
    // `app.user_roles` those policies split, so the two cannot disagree about
    // who is an admin. Everyone else stays on `role`, whose plans no longer
    // carry those policies at all.
    const admin = role && typeof userRole === "object" && holdsAdminRole(normalizedRoles.map(String))
        ? userRole.adminRoleFor?.(role)
        : undefined;
    if (role) settings.push(["role", admin ?? role]);
    return settings;
}

/** Role names from other BaaS platforms that people reach for out of habit. */
const FOREIGN_CONVENTION_ROLES: Record<string, string> = {
    authenticated: "Supabase",
    anon: "Supabase",
    service_role: "Supabase"
};

/**
 * Warn about rules that read as "signed-in users only" but admit anonymous
 * callers — `rebase.uid() IS NOT NULL`, or a comparison against another
 * platform's magic user id such as `'anon'`.
 *
 * The sibling of {@link validatePolicyPgRoles}, for the more dangerous spelling
 * of the same habit. A foreign `pgRoles` value makes a policy unreachable and
 * the table reads empty — loud, and that guard throws. These do the opposite:
 * the rule compiles to a grant, and nothing looks wrong until the data is
 * already public.
 *
 * Warns rather than throws. Unlike an unreachable `pgRoles`, these rules are
 * serving traffic today: refusing to boot would take an app offline to report a
 * problem it already has, and on the read path it would take it offline
 * *because* its data was exposed. Rewriting the author's SQL is not an option
 * either — this is the escape hatch whose whole promise is that it means what it
 * says. So: say so, loudly, and leave the rule alone.
 */
export function warnOnAnonymousGrants(
    collections: { slug?: string; securityRules?: readonly SecurityRule[] }[]
): void {
    // Grouped by the mistake, not by the rule: one habit typically repeats
    // across every collection an author wrote, and a per-rule list would repeat
    // the same paragraph dozens of times and get skimmed.
    const byRisk = new Map<string, { risk: AnonymousGrantRisk; sites: string[] }>();

    for (const collection of collections) {
        for (const rule of collection.securityRules ?? []) {
            const { usingExpr, withCheckExpr } = securityRuleToConditions(rule);
            const risks = [usingExpr, withCheckExpr]
                .filter((e): e is PolicyExpression => e !== null)
                .flatMap(findAnonymousGrants);

            for (const risk of risks) {
                const key = `${risk.pattern}:${risk.detail}`;
                const site = `${collection.slug ?? "(unnamed)"} → "${rule.name ?? "(unnamed rule)"}"`;
                const entry = byRisk.get(key) ?? { risk, sites: [] };
                if (!entry.sites.includes(site)) entry.sites.push(site);
                byRisk.set(key, entry);
            }
        }
    }

    if (byRisk.size === 0) return;

    const problems = [...byRisk.values()].map(({ risk, sites }) =>
        `  • ${risk.explanation}\n    ${sites.length} rule(s): ${sites.join(", ")}`
    );

    logger.warn(
        `Security rules that read as a lockdown but grant access to anonymous requests. Every caller from a ` +
        `client carries a user id ('${ANONYMOUS_USER_ID}' when nobody is signed in), so these clauses are ` +
        `true for everyone:\n\n` +
        problems.join("\n\n") + "\n"
    );
}

/**
 * Name the collections whose raw policy SQL still calls the pre-1.0 helpers.
 *
 * The compiler rewrites `auth.uid()` to `rebase.uid()` on the way into the
 * database, so nothing is broken and no policy is wrong — which is exactly why
 * this has to be said out loud. A silent rewrite that works forever is not a
 * migration, it is a second supported spelling nobody wrote down, and the next
 * person to read those rules will copy the old one.
 *
 * Only `raw` expressions can carry it. Structured rules (`policy.authUid()`,
 * `policy.rolesOverlap(...)`) compile from the model and were never affected.
 */
export function warnOnLegacyRlsFunctions(
    collections: { slug?: string; securityRules?: readonly SecurityRule[] }[]
): void {
    const sites: string[] = [];

    for (const collection of collections) {
        for (const rule of collection.securityRules ?? []) {
            const { usingExpr, withCheckExpr } = securityRuleToConditions(rule);
            const carriesLegacy = [usingExpr, withCheckExpr]
                .filter((e): e is PolicyExpression => e !== null)
                .some(containsLegacyRlsCall);
            if (!carriesLegacy) continue;

            const site = `${collection.slug ?? "(unnamed)"} → "${rule.name ?? "(unnamed rule)"}"`;
            if (!sites.includes(site)) sites.push(site);
        }
    }

    if (sites.length === 0) return;

    logger.warn(
        `These security rules call the pre-1.0 RLS helpers (\`auth.uid()\`, \`auth.roles()\`, \`auth.jwt()\`). ` +
        `They still work — the compiler rewrites them — but the functions now live in the \`rebase\` schema, ` +
        `and the \`auth\` one is Supabase's. Update the raw SQL in these rules to \`${REBASE_SCHEMA}.uid()\` ` +
        `and friends, or switch them to the structured helpers (\`policy.authUid()\`, \`policy.rolesOverlap()\`), ` +
        `which never had to be spelled by hand:\n\n` +
        sites.map(s => `  • ${s}`).join("\n") + "\n"
    );
}

/** Whether any `raw` expression in the tree calls a pre-1.0 helper. */
function containsLegacyRlsCall(expr: PolicyExpression): boolean {
    switch (expr.kind) {
        case "raw":
            return usesLegacyRlsFunctions(expr.sql);
        case "and":
        case "or":
            return expr.operands.some(containsLegacyRlsCall);
        case "not":
            return containsLegacyRlsCall(expr.operand);
        case "existsIn":
            return containsLegacyRlsCall(expr.where);
        default:
            return false;
    }
}

/**
 * Reject `pgRoles` that this server can never satisfy.
 *
 * `pgRoles` sets the `TO` clause of a generated policy, so a policy naming a
 * role the request never runs as simply never applies — and RLS then filters
 * every row. The table reads as empty, which is indistinguishable from having
 * no data, so the mistake survives review and ships.
 *
 * Requests run as `rebase_user`, so a policy is only reachable if it targets
 * `public` or a role whose privileges `rebase_user` has. Anything else is a
 * configuration error worth failing the boot for.
 *
 * Privileges, not membership: Postgres applies a policy `TO r` to a role that
 * has `r`'s privileges, which a member only gets by inheriting them, and
 * `rebase_user` is `NOINHERIT`. This used to ask `pg_has_role(…, 'MEMBER')`, so
 * `GRANT authenticated TO rebase_user` — the grant its own hint suggested —
 * passed here and still read every collection as empty.
 */
export async function validatePolicyPgRoles(
    run: RawSqlRunner,
    collections: { slug?: string; securityRules?: readonly { name?: string; pgRoles?: readonly string[] }[] }[],
    /** The role(s) requests actually run as: `rebase_user` (or the `rls.requestRole`
     *  roles) when the connection is privileged enough to switch, otherwise the
     *  connection role itself. With several, a role is usable when any reaches it. */
    requestRoles: string | readonly string[] = REBASE_USER_ROLE
): Promise<void> {
    const candidates = typeof requestRoles === "string" ? [requestRoles] : [...requestRoles];
    const requestRole = candidates[0] ?? REBASE_USER_ROLE;
    const wanted = new Map<string, string[]>();
    for (const collection of collections) {
        for (const rule of collection.securityRules ?? []) {
            for (const role of rule.pgRoles ?? []) {
                if (role === "public" || candidates.includes(role)) continue;
                wanted.set(role, [...(wanted.get(role) ?? []), collection.slug ?? "(unnamed)"]);
            }
        }
    }
    if (wanted.size === 0) return;

    const names = [...wanted.keys()].map((r) => `'${r.replace(/'/g, "''")}'`).join(",");
    const escapedRequestRole = requestRole.replace(/'/g, "''");
    const rows = await run(`
        SELECT r.rolname AS role,
               COALESCE(bool_or(pg_has_role(to_regrole(req.name), r.oid, 'USAGE')), false) AS reachable,
               COALESCE(bool_or(pg_has_role(to_regrole(req.name), r.oid, 'MEMBER')), false) AS member
        FROM pg_roles r CROSS JOIN unnest(${textArray(candidates)}) AS req(name)
        WHERE r.rolname IN (${names})
        GROUP BY r.rolname
    `);
    const [server] = await run(`
        SELECT current_setting('server_version_num')::int >= 160000 AS per_grant_inherit,
               (SELECT rolinherit FROM pg_roles WHERE oid = to_regrole('${escapedRequestRole}')) AS inherits
    `);
    // From 16 inheritance is an option of each grant, so one membership can pass
    // its privileges on while the role stays NOINHERIT for every other. Before
    // 16 it is the role's attribute: a NOINHERIT role inherits from nothing.
    const grantThatWorks = (role: string): string | undefined =>
        server?.per_grant_inherit === true
            ? `GRANT ${role} TO ${requestRole} WITH INHERIT TRUE`
            : server?.inherits === true ? `GRANT ${role} TO ${requestRole}` : undefined;

    const found = new Map(rows.map((row) => [String(row.role), row]));
    const problems: string[] = [];

    for (const [role, slugs] of wanted) {
        const row = found.get(role);
        if (row?.reachable === true) continue;

        const why = !row
            ? "no such role exists in this database"
            : row.member === true
                ? `"${requestRole}" is a member of it but does not inherit its privileges, so its policies do not apply`
                : `"${requestRole}" is not a member of it`;
        const platform = FOREIGN_CONVENTION_ROLES[role];
        const grant = grantThatWorks(role);
        const hint = platform && !row
            ? `"${role}" is a ${platform} convention, not a PostgreSQL role. Application roles belong in \`roles: ["${role === "service_role" ? "admin" : role}"]\`, which is checked inside the policy via rebase.roles().`
            : grant
                ? `Either grant it (${grant}) or drop \`pgRoles\` so the policy targets \`public\`.`
                : `"${requestRole}" is NOINHERIT, and before PostgreSQL 16 a NOINHERIT role takes on no other role's policies. Drop \`pgRoles\` so the policy targets \`public\`.`;

        problems.push(
            `  • pgRoles: ["${role}"] on ${slugs.join(", ")} — ${why}.\n    ${hint}`
        );
    }

    if (problems.length > 0) {
        throw new Error(
            `Security rules target PostgreSQL roles this server cannot use. Requests run as ` +
            `"${requestRole}", so these policies would never apply and every row would be ` +
            `filtered out — the collections would look empty rather than error.\n\n` +
            problems.join("\n\n") + "\n"
        );
    }
}
