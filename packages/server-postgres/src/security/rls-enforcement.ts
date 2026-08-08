import { sql as drizzleSql, SQL } from "drizzle-orm";
import { ANONYMOUS_USER_ID, PolicyExpression, SecurityRule } from "@rebasepro/types";
import {
    AnonymousGrantRisk,
    findAnonymousGrants,
    REBASE_USER_ROLE,
    revokeInternalTableAccess,
    securityRuleToConditions
} from "@rebasepro/common";
import { REBASE_SCHEMA, usesLegacyRlsFunctions } from "@rebasepro/types";
import { logger } from "@rebasepro/server";

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
 *    `auth.uid() IS NULL` one.
 *
 * This module provides the three pieces:
 *
 *  1. {@link detectConnectionPosture} — is the connection subject to RLS at
 *     all? (superuser / BYPASSRLS / table owner ⇒ no)
 *  2. {@link ensureAppRole} — idempotently provision `rebase_user` with
 *     SELECT/INSERT/UPDATE/DELETE grants (+ default privileges so future
 *     tables stay covered).
 *  3. {@link applyAuthContext} — per-transaction: set the `app.*` GUCs the
 *     policies read (`auth.uid()` etc.) and `SET LOCAL ROLE rebase_user` so
 *     RLS binds. Transaction-scoped, so it composes with poolers.
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
    /** Owns at least one user table — owners bypass non-FORCE RLS. */
    ownsTables: boolean;
    /** True when RLS would NOT constrain this connection. */
    privileged: boolean;
}

export interface AuthContext {
    uid: string;
    /** Raw roles as carried on the user (strings or `{ id }` objects). */
    roles: unknown[];
}

const quoteIdent = (name: string): string => `"${name.replace(/"/g, "\"\"")}"`;

/** DML the user role holds on managed tables (RLS still filters per row). */
const USER_TABLE_PRIVILEGES = "SELECT, INSERT, UPDATE, DELETE";

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

export async function detectConnectionPosture(run: RawSqlRunner): Promise<ConnectionPosture> {
    const rows = await run(`
        SELECT current_user            AS role,
               r.rolsuper              AS superuser,
               r.rolbypassrls          AS bypassrls,
               EXISTS (
                   SELECT 1 FROM pg_tables t
                   WHERE t.tableowner = current_user
                     AND t.schemaname NOT IN ('pg_catalog', 'information_schema')
               )                       AS owns_tables
        FROM pg_roles r
        WHERE r.rolname = current_user
    `);
    const row = rows[0] ?? {};
    const superuser = row.superuser === true;
    const bypassRLS = row.bypassrls === true;
    const ownsTables = row.owns_tables === true;
    return {
        role: String(row.role ?? "unknown"),
        superuser,
        bypassRLS,
        ownsTables,
        privileged: superuser || bypassRLS || ownsTables
    };
}

/**
 * Human-actionable instructions for when the connection cannot provision the
 * user role itself (no CREATEROLE and role not pre-created by the platform).
 */
export function appRoleSetupInstructions(connectionRole: string, schemas: string[]): string {
    const grants = schemas.map((s) =>
        `GRANT USAGE ON SCHEMA ${quoteIdent(s)} TO ${REBASE_USER_ROLE};\n` +
        `GRANT ${USER_TABLE_PRIVILEGES} ON ALL TABLES IN SCHEMA ${quoteIdent(s)} TO ${REBASE_USER_ROLE};\n` +
        `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${quoteIdent(s)} TO ${REBASE_USER_ROLE};`
    ).join("\n");
    return (
        `Rebase enforces row-level security by running authenticated requests as ` +
        `the restricted role "${REBASE_USER_ROLE}", but the connection role ` +
        `"${connectionRole}" bypasses RLS and cannot create that role itself.\n` +
        `Run the following as a database administrator, then restart:\n\n` +
        `CREATE ROLE ${REBASE_USER_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;\n` +
        `GRANT ${REBASE_USER_ROLE} TO ${quoteIdent(connectionRole)};\n` +
        grants
    );
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
 * Throws with precise setup instructions when the role is missing and the
 * connection cannot create it.
 */
export async function ensureAppRole(run: RawSqlRunner, schemas: string[]): Promise<void> {
    const uniqueSchemas = Array.from(new Set(schemas.filter(Boolean)));

    // Tier 1 — role existence.
    const roleRows = await run(`SELECT 1 FROM pg_roles WHERE rolname = '${REBASE_USER_ROLE}'`);
    if (roleRows.length === 0) {
        try {
            await run(`CREATE ROLE ${REBASE_USER_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`);
        } catch (err) {
            throw new Error(
                `Failed to create the "${REBASE_USER_ROLE}" role: ${err instanceof Error ? err.message : String(err)}\n\n` +
                appRoleSetupInstructions("current connection role", uniqueSchemas)
            );
        }
    }

    // Tier 2 — membership, so a non-superuser connection may SET ROLE to it.
    const memberRows = await run(`
        SELECT (pg_has_role(current_user, '${REBASE_USER_ROLE}', 'MEMBER')
                OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)) AS can_set,
               current_user AS role
    `);
    if (memberRows[0]?.can_set !== true) {
        try {
            await run(`GRANT ${REBASE_USER_ROLE} TO CURRENT_USER`);
        } catch (err) {
            throw new Error(
                `The connection role is not a member of "${REBASE_USER_ROLE}" and cannot grant itself membership: ` +
                `${err instanceof Error ? err.message : String(err)}\n\n` +
                appRoleSetupInstructions(String(memberRows[0]?.role ?? "current connection role"), uniqueSchemas)
            );
        }
    }

    // Tier 3 — grants. Table owners (the expected non-superuser posture) can
    // always grant on their own objects, so this tier needs no extra privilege.
    const nspRows = await run("SELECT nspname FROM pg_namespace");
    const existing = new Set(nspRows.map((r) => String(r.nspname)));
    for (const schema of uniqueSchemas) {
        if (!existing.has(schema)) continue;
        const s = quoteIdent(schema);
        await run(`GRANT USAGE ON SCHEMA ${s} TO ${REBASE_USER_ROLE}`);
        await run(`GRANT ${USER_TABLE_PRIVILEGES} ON ALL TABLES IN SCHEMA ${s} TO ${REBASE_USER_ROLE}`);
        await run(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${s} TO ${REBASE_USER_ROLE}`);
        // Cover objects created later by the CURRENT role (the role that runs
        // migrations), so a migrate can never strand the user role.
        await run(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} GRANT ${USER_TABLE_PRIVILEGES} ON TABLES TO ${REBASE_USER_ROLE}`);
        await run(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} GRANT USAGE, SELECT ON SEQUENCES TO ${REBASE_USER_ROLE}`);

        // The grants above are deliberately schema-wide — a project's own
        // collections may live in `rebase`, and future tables must be reachable
        // or a migration strands the role. Rebase's OWN tables are the exception:
        // refresh tokens, MFA secrets, API keys and the rest carry no RLS and no
        // row an end user should ever address. Taking the privilege back here
        // covers every table that already exists; each creator revokes on the
        // table it just made, for the boot that creates them for the first time.
        await revokeInternalTableAccess(async (text) => { await run(text); }, schema, {
            onError: (table, error) => logger.warn(
                `🔐 [rls] Could not revoke "${REBASE_USER_ROLE}" access to "${schema}"."${table}" — ` +
                "it stays reachable by authenticated requests: " +
                (error instanceof Error ? error.message : String(error))
            )
        });
    }

    logger.info(`🔐 [rls] User role "${REBASE_USER_ROLE}" provisioned (schemas: ${uniqueSchemas.join(", ")})`);
}

/**
 * Apply the authenticated context to a transaction: the `app.*` GUCs that RLS
 * policies read via `auth.uid()` / `auth.roles()` / `auth.jwt()`, and — when
 * `userRole` is set — `SET LOCAL ROLE` so RLS binds every statement in this
 * transaction (reads *and* writes).
 *
 * GUCs are set with `is_local = true` and the role switch is `LOCAL`: both
 * reset at commit/rollback, so pooled connections are never polluted.
 *
 * Fails closed by construction: if the role switch errors, the transaction
 * aborts instead of proceeding privileged.
 *
 * SECURITY: this function is only ever called on the **user** path (the server
 * context uses the base/owner driver and never calls it). The default policies
 * treat `auth.uid() IS NULL` as the trusted server context, and `auth.uid()`
 * is `NULLIF(current_setting('app.uid'), '')` — so an EMPTY user id would
 * be read as NULL and silently escalate a user request to server privileges.
 * Coerce empty/blank ids to `ANONYMOUS_USER_ID` here, at the single chokepoint,
 * rather than trusting every caller (e.g. realtime subscription auth) to do it.
 * That sentinel is exported from `@rebasepro/types` because it leaks into rule
 * semantics: it is why `auth.uid() IS NOT NULL` is true for anonymous requests.
 */
export async function applyAuthContext(tx: SqlTx, auth: AuthContext, userRole?: string): Promise<void> {
    const uid = typeof auth.uid === "string" && auth.uid.trim() !== "" ? auth.uid : ANONYMOUS_USER_ID;
    const normalizedRoles = auth.roles.map((r: unknown) =>
        typeof r === "string" ? r : (r as Record<string, unknown>)?.id ?? String(r)
    );
    // `app.user_id` is the pre-rename spelling, still written because policies
    // are data: a database provisioned before the rename holds rules compiled
    // to `current_setting('app.user_id')`, and those predicates would evaluate
    // to NULL — failing open or locking out — if we stopped setting it. Drop
    // the alias only once no live database carries a legacy policy.
    await tx.execute(drizzleSql`
        SELECT
            set_config('app.uid', ${uid}, true),
            set_config('app.user_id', ${uid}, true),
            set_config('app.user_roles', ${normalizedRoles.join(",")}, true),
            set_config('app.jwt', ${JSON.stringify({ sub: uid, roles: auth.roles })}, true)
    `);
    if (userRole) {
        await tx.execute(drizzleSql.raw(`SET LOCAL ROLE ${quoteIdent(userRole)}`));
    }
}

/** Role names from other BaaS platforms that people reach for out of habit. */
const FOREIGN_CONVENTION_ROLES: Record<string, string> = {
    authenticated: "Supabase",
    anon: "Supabase",
    service_role: "Supabase"
};

/**
 * Warn about rules that read as "signed-in users only" but admit anonymous
 * callers — `auth.uid() IS NOT NULL`, or a comparison against another
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
            ? `"${role}" is a ${platform} convention, not a PostgreSQL role. Application roles belong in \`roles: ["${role === "service_role" ? "admin" : role}"]\`, which is checked inside the policy via auth.roles().`
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
