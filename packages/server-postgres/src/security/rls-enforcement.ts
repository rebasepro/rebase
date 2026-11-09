import { sql as drizzleSql, SQL } from "drizzle-orm";
import { ANONYMOUS_USER_ID, PolicyExpression, SecurityRule } from "@rebasepro/types";
import {
    AnonymousGrantRisk,
    findAnonymousGrants,
    REBASE_INTERNAL_TABLES,
    REBASE_USER_ROLE,
    revokeInternalTableAccess,
    securityRuleToConditions
} from "@rebasepro/common";
import { REBASE_SCHEMA, usesLegacyRlsFunctions } from "@rebasepro/types";
import { logger } from "@rebasepro/server";
import { extractCauseMessage } from "../utils/error-cause";

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
 * Take every privilege the user role holds on one table back — what a table
 * gets when RLS cannot be switched on for it, so it is unreachable rather than
 * unprotected. Quoted exactly: a mixed-case adopted table (`"User"`) folded to
 * lower case names a table that does not exist.
 */
export const revokeUserRoleSql = (schema: string, table: string): string =>
    `REVOKE ALL PRIVILEGES ON ${quoteIdent(schema)}.${quoteIdent(table)} FROM ${quoteIdent(REBASE_USER_ROLE)}`;

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
function membershipGrantSql(connectionRole: string): string {
    const member = sqlLiteral(connectionRole);
    const role = sqlLiteral(REBASE_USER_ROLE);
    return (
        `DO $rebase_grant$\n` +
        `BEGIN\n` +
        `    IF current_setting('server_version_num')::int >= ${SET_OPTION_SINCE} THEN\n` +
        `        EXECUTE format('GRANT %I TO %I WITH SET TRUE, INHERIT FALSE', ${role}, ${member});\n` +
        `    ELSE\n` +
        `        EXECUTE format('GRANT %I TO %I', ${role}, ${member});\n` +
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
export function appRoleSetupInstructions(connectionRole: string | undefined, schemas: string[]): string {
    const member = connectionRole ?? "<your database user>";
    const grants = schemas.map((s) =>
        `GRANT USAGE ON SCHEMA ${quoteIdent(s)} TO ${REBASE_USER_ROLE};\n` +
        `GRANT ${USER_TABLE_PRIVILEGES} ON ALL TABLES IN SCHEMA ${quoteIdent(s)} TO ${REBASE_USER_ROLE};\n` +
        `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${quoteIdent(s)} TO ${REBASE_USER_ROLE};`
    ).join("\n");
    return (
        `Rebase enforces row-level security by running authenticated requests as ` +
        `the restricted role "${REBASE_USER_ROLE}", but the connection role ` +
        `"${member}" bypasses RLS and cannot set that role up itself.\n` +
        `Run the following as a database administrator (a superuser, or the role that created ` +
        `"${REBASE_USER_ROLE}"), then restart:\n\n` +
        `DO $rebase_role$\n` +
        `BEGIN\n` +
        `    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${sqlLiteral(REBASE_USER_ROLE)}) THEN\n` +
        `        CREATE ROLE ${REBASE_USER_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;\n` +
        `    END IF;\n` +
        `END\n` +
        `$rebase_role$;\n` +
        `${membershipGrantSql(member)}\n` +
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
export async function assertAppRoleRestricted(run: RawSqlRunner): Promise<void> {
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
        WHERE r.rolname = ${sqlLiteral(REBASE_USER_ROLE)}
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
    if (attributes.length > 0) fixes.push(`ALTER ROLE ${REBASE_USER_ROLE} ${attributes.join(" ")};`);
    if (memberships.length > 0) {
        problems.push(
            `it is a member of ${memberships.map((m) => `"${m}"`).join(", ")} — a role that owns tables or ` +
            "logs in, or is a superuser or BYPASSRLS — so requests can act as that role"
        );
        for (const m of memberships) fixes.push(`REVOKE ${quoteIdent(m)} FROM ${REBASE_USER_ROLE};`);
    }
    if (problems.length === 0) return;
    throw new AppRoleSetupError(
        `Refusing to use the existing "${REBASE_USER_ROLE}" role: every authenticated request runs as it, ` +
        `and ${problems.join("; ")}. Row-level security would not restrict those requests.`,
        `Run the following as a database administrator, then restart. If another application on this ` +
        `cluster relies on "${REBASE_USER_ROLE}" being this way, the two cannot share it.\n\n` +
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
const ROLE_SWITCH_PROBE = `
    SELECT set_config('role', switched.previous, true) AS restored
    FROM (
        SELECT session.previous, set_config('role', ${sqlLiteral(REBASE_USER_ROLE)}, true) AS probe
        FROM (SELECT current_setting('role') AS previous OFFSET 0) session
        OFFSET 0
    ) switched
`;

/**
 * Run {@link ROLE_SWITCH_PROBE}, and on a refusal throw an
 * {@link AppRoleSetupError} carrying the SQL that grants the switch.
 *
 * For a boot that adopts the role without provisioning it as much as for one
 * that just did: either way the next thing that happens is a request running
 * as it.
 */
export async function proveRoleSwitch(run: RawSqlRunner, schemas: string[], connectionRole?: string): Promise<void> {
    try {
        await run(ROLE_SWITCH_PROBE);
    } catch (err) {
        const role = connectionRole ?? String((await run("SELECT current_user AS role").catch(() => []))[0]?.role ?? "");
        throw new AppRoleSetupError(
            `The connection role "${role}" cannot switch to "${REBASE_USER_ROLE}", so every ` +
            `authenticated request would fail: ${failureReason(err)}`,
            appRoleSetupInstructions(role || undefined, Array.from(new Set(schemas.filter(Boolean))))
        );
    }
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
export async function ensureAppRole(run: RawSqlRunner, schemas: string[]): Promise<void> {
    const uniqueSchemas = Array.from(new Set(schemas.filter(Boolean)));

    const [who] = await run(`
        SELECT current_user AS role,
               (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser,
               current_setting('server_version_num')::int >= ${SET_OPTION_SINCE} AS set_option,
               EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${sqlLiteral(REBASE_USER_ROLE)}) AS role_exists
    `);
    const connectionRole = String(who?.role ?? "");
    const superuser = who?.superuser === true;
    const setOption = who?.set_option === true;
    const instructions = () => appRoleSetupInstructions(connectionRole || undefined, uniqueSchemas);

    // Tier 1 — role existence, and a role found rather than made is checked
    // before anything is granted to it or runs as it.
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
                    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${REBASE_USER_ROLE}') THEN
                        CREATE ROLE ${REBASE_USER_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
                    END IF;
                END
                $rebase_role$
            `);
        } catch (err) {
            throw new AppRoleSetupError(`Failed to create the "${REBASE_USER_ROLE}" role: ${failureReason(err)}`, instructions());
        }
    } else {
        await assertAppRoleRestricted(run);
    }

    // Tier 2 — membership with the right to SET ROLE to it. A superuser needs
    // none. From 16 that right is its own option, and MEMBER alone is not it.
    if (!superuser) {
        const [membership] = await run(
            `SELECT pg_has_role(current_user, ${sqlLiteral(REBASE_USER_ROLE)}, '${setOption ? "SET" : "MEMBER"}') AS can_set`
        );
        if (membership?.can_set !== true) {
            try {
                await run(setOption
                    ? `GRANT ${REBASE_USER_ROLE} TO CURRENT_USER WITH SET TRUE, INHERIT FALSE`
                    : `GRANT ${REBASE_USER_ROLE} TO CURRENT_USER`);
            } catch (err) {
                throw new AppRoleSetupError(
                    `The connection role "${connectionRole}" may not switch to "${REBASE_USER_ROLE}" ` +
                    `${setOption ? "(no membership WITH SET TRUE)" : "(not a member)"} and cannot grant that ` +
                    `to itself: ${failureReason(err)}`,
                    instructions()
                );
            }
        }
    }

    // Tier 2b — the switch itself. Without this the boot logged enforcement as
    // active on a connection Postgres would refuse on the first request.
    await proveRoleSwitch(run, uniqueSchemas, connectionRole || undefined);

    // Tier 3 — grants.
    await ensureAppRoleGrants(run, uniqueSchemas);

    logger.debug(`🔐 [rls] User role "${REBASE_USER_ROLE}" provisioned (schemas: ${uniqueSchemas.join(", ")})`);
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
export async function findExposedInternalTables(run: RawSqlRunner, schemas: string[]): Promise<string[]> {
    const rows = await run(`
        SELECT n.nspname || '.' || c.relname AS name
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ANY(${textArray(Array.from(new Set(schemas)))})
          AND c.relname = ANY(${textArray(REBASE_INTERNAL_TABLES)})
          AND c.relkind IN ('r', 'p')
          AND NOT c.relrowsecurity
          AND (has_table_privilege(${sqlLiteral(REBASE_USER_ROLE)}, c.oid, 'SELECT, INSERT, UPDATE, DELETE')
               OR has_any_column_privilege(${sqlLiteral(REBASE_USER_ROLE)}, c.oid, 'SELECT, INSERT, UPDATE'))
        ORDER BY 1
    `);
    return rows.map(row => String(row.name));
}

/** What the grant tier would find already in place in one schema. */
interface SchemaGrants {
    /** `USAGE` on the schema, granted by its owner. */
    usage: boolean;
    /**
     * Every relation `GRANT … ON ALL TABLES` reaches already has all four DML
     * privileges from its owner — Rebase's own RLS-off tables aside, which the
     * sweep takes back right after and so never keep them.
     */
    tables: boolean;
    /** Every sequence already has `USAGE, SELECT` from its owner. */
    sequences: boolean;
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
}

/**
 * The grant tier's state for every existing schema in `schemas`, in one read.
 *
 * A grant counts as present only as the statement this tier runs would record
 * it — grantor the object's owner, which is what a GRANT by the owner, a member
 * of the owning role or a superuser records — so skipping it leaves the ACL
 * exactly as running it would. Anything else reads as missing, and the
 * statement runs as it always did.
 */
async function readSchemaGrants(run: RawSqlRunner, schemas: string[]): Promise<Map<string, SchemaGrants>> {
    const internal = textArray(REBASE_INTERNAL_TABLES);
    const target = `(SELECT oid FROM pg_roles WHERE rolname = ${sqlLiteral(REBASE_USER_ROLE)})`;
    /** Distinct privileges `acl` gives the user role (from `grantor`, when given) out of `privileges`. */
    const held = (acl: string, privileges: string[], grantor?: string): string =>
        `(SELECT count(DISTINCT a.privilege_type) FROM aclexplode(${acl}) a WHERE a.grantee = ${target}` +
        `${grantor ? ` AND a.grantor = ${grantor}` : ""} AND a.privilege_type IN (${privileges.map(sqlLiteral).join(", ")}))`;
    const DML = ["SELECT", "INSERT", "UPDATE", "DELETE"];
    const SEQ = ["USAGE", "SELECT"];
    const rows = await run(`
        SELECT n.nspname AS schema,
               ${held("n.nspacl", ["USAGE"], "n.nspowner")} = 1 AS usage,
               NOT EXISTS (
                   SELECT 1 FROM pg_class c
                   WHERE c.relnamespace = n.oid AND c.relkind IN ('r', 'v', 'm', 'f', 'p')
                     AND NOT (c.relname = ANY(${internal}) AND NOT c.relrowsecurity)
                     AND ${held("c.relacl", DML, "c.relowner")} < ${DML.length}
               ) AS tables,
               NOT EXISTS (
                   SELECT 1 FROM pg_class c
                   WHERE c.relnamespace = n.oid AND c.relkind = 'S'
                     AND ${held("c.relacl", SEQ, "c.relowner")} < ${SEQ.length}
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
               ) AS internal_granted
        FROM pg_namespace n
        WHERE n.nspname = ANY(${textArray(schemas)})
    `);
    const grants = new Map<string, SchemaGrants>();
    for (const row of rows) {
        const internalGranted = row.internal_granted;
        grants.set(String(row.schema), {
            usage: row.usage === true,
            tables: row.tables === true,
            sequences: row.sequences === true,
            defaultTables: row.default_tables === true,
            defaultSequences: row.default_sequences === true,
            internalGranted: textArrayValue(internalGranted)
        });
    }
    return grants;
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
 * hold now reads one catalogue query and writes nothing; one that is missing
 * any of them runs exactly the statements it always ran.
 *
 * Table owners (the expected non-superuser posture) can always grant on their
 * own objects, so this needs no extra privilege.
 */
export async function ensureAppRoleGrants(run: RawSqlRunner, schemas: string[]): Promise<void> {
    const uniqueSchemas = Array.from(new Set(schemas.filter(Boolean)));
    const grants = await readSchemaGrants(run, uniqueSchemas);
    for (const schema of uniqueSchemas) {
        const state = grants.get(schema);
        // Not there (yet): a later call, once provisioning has created it, grants it.
        if (!state) continue;
        const s = quoteIdent(schema);
        if (!state.usage) await run(`GRANT USAGE ON SCHEMA ${s} TO ${REBASE_USER_ROLE}`);
        if (!state.tables) await run(`GRANT ${USER_TABLE_PRIVILEGES} ON ALL TABLES IN SCHEMA ${s} TO ${REBASE_USER_ROLE}`);
        if (!state.sequences) await run(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${s} TO ${REBASE_USER_ROLE}`);
        // Cover objects created later by the CURRENT role (the role that runs
        // migrations), so a migrate can never strand the user role.
        if (!state.defaultTables) {
            await run(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} GRANT ${USER_TABLE_PRIVILEGES} ON TABLES TO ${REBASE_USER_ROLE}`);
        }
        if (!state.defaultSequences) {
            await run(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} GRANT USAGE, SELECT ON SEQUENCES TO ${REBASE_USER_ROLE}`);
        }

        // The grants above are deliberately schema-wide — a project's own
        // collections may live in `rebase`, and future tables must be reachable
        // or a migration strands the role. Rebase's OWN tables are the exception:
        // refresh tokens, MFA secrets, API keys and the rest carry no RLS and no
        // row an end user should ever address. Taking the privilege back here
        // covers every table that already exists; each creator revokes on the
        // table it just made, for the boot that creates them for the first time.
        //
        // All of them right after the schema-wide grant, which has just handed
        // them out; otherwise only the ones the catalogue says still hold one.
        const tables = state.tables ? state.internalGranted : undefined;
        if (tables && tables.length === 0) continue;
        await revokeInternalTableAccess(async (text) => { await run(text); }, schema, {
            tables,
            onError: (table, error) => logger.warn(
                `🔐 [rls] Could not revoke "${REBASE_USER_ROLE}" access to "${schema}"."${table}" — ` +
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
export async function internalTablesGrantedToUserRole(run: RawSqlRunner, schema: string): Promise<string[]> {
    return (await readSchemaGrants(run, [schema])).get(schema)?.internalGranted ?? [];
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
export async function applyAuthContext(tx: SqlTx, auth: AuthContext, userRole?: string): Promise<void> {
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
    userRole?: string,
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
 */
function authContextSettings(auth: AuthContext, userRole?: string): [string, string][] {
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
    if (userRole) settings.push(["role", userRole]);
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
 * `public` or a role `rebase_user` holds. Anything else is a configuration
 * error worth failing the boot for.
 */
export async function validatePolicyPgRoles(
    run: RawSqlRunner,
    collections: { slug?: string; securityRules?: readonly { name?: string; pgRoles?: readonly string[] }[] }[],
    /** The role requests actually run as: `rebase_user` when the connection is
     *  privileged enough to switch, otherwise the connection role itself. */
    requestRole: string = REBASE_USER_ROLE
): Promise<void> {
    const wanted = new Map<string, string[]>();
    for (const collection of collections) {
        for (const rule of collection.securityRules ?? []) {
            for (const role of rule.pgRoles ?? []) {
                if (role === "public") continue;
                wanted.set(role, [...(wanted.get(role) ?? []), collection.slug ?? "(unnamed)"]);
            }
        }
    }
    if (wanted.size === 0) return;

    const names = [...wanted.keys()].map((r) => `'${r.replace(/'/g, "''")}'`).join(",");
    const escapedRequestRole = requestRole.replace(/'/g, "''");
    const rows = await run(`
        SELECT r.rolname AS role,
               COALESCE(pg_has_role(to_regrole('${escapedRequestRole}'), r.oid, 'MEMBER'), false) AS reachable
        FROM pg_roles r
        WHERE r.rolname IN (${names})
    `);

    const reachable = new Map(rows.map((row) => [String(row.role), row.reachable === true]));
    const problems: string[] = [];

    for (const [role, slugs] of wanted) {
        if (reachable.get(role) === true) continue;

        const why = reachable.has(role)
            ? `"${requestRole}" is not a member of it`
            : "no such role exists in this database";
        const platform = FOREIGN_CONVENTION_ROLES[role];
        const hint = platform
            ? `"${role}" is a ${platform} convention, not a PostgreSQL role. Application roles belong in \`roles: ["${role === "service_role" ? "admin" : role}"]\`, which is checked inside the policy via rebase.roles().`
            : `Either grant it (GRANT ${role} TO ${requestRole}) or drop \`pgRoles\` so the policy targets \`public\`.`;

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
