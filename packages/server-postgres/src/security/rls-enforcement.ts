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

    // Tier 3 — grants.
    await ensureAppRoleGrants(run, uniqueSchemas);

    logger.debug(`🔐 [rls] User role "${REBASE_USER_ROLE}" provisioned (schemas: ${uniqueSchemas.join(", ")})`);
}

/** A string literal for a catalogue read. Names come from config and constants, never from a request. */
const sqlLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;
const textArray = (values: readonly string[]): string =>
    values.length === 0 ? "ARRAY[]::text[]" : `ARRAY[${values.map(sqlLiteral).join(", ")}]::text[]`;

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
            internalGranted: Array.isArray(internalGranted)
                ? internalGranted.map(String)
                // A driver that hands arrays back as text: `{a,b}`.
                : String(internalGranted ?? "").replace(/^\{|\}$/g, "").split(",").filter(Boolean)
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

    await tx.execute(drizzleSql`
        SELECT
            set_config('app.uid', ${uid}, true),
            set_config('app.user_id', ${uid}, true),
            set_config('app.user_roles', ${normalizedRoles.join(",")}, true),
            set_config('app.is_anonymous', ${isAnonymous}, true),
            set_config('app.jwt', ${JSON.stringify({
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
    })}, true)${userRole
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
        ? drizzleSql`,
            set_config('role', ${userRole}, true)`
        : drizzleSql``}
    `);
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
