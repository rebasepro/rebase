/**
 * Applying a bundle's RLS policies to a database at boot, idempotently.
 *
 * ## Why this exists
 *
 * {@link ensureCollectionTables} creates the collection *tables* a managed
 * runtime boots against, but a table with row-level security disabled and no
 * policies is not servable: authenticated requests run as the restricted
 * `rebase_user` role, so a read with no `SELECT` policy returns nothing (a
 * public collection answered 401) and a write with no `INSERT`/`UPDATE` policy
 * is denied. The policies live in the collections' `securityRules`; nothing at
 * boot applied them. `rebase db push` does — but it drives Atlas against a
 * local `DATABASE_URL`, and a managed tenant's database is reachable only from
 * inside the cluster, by the runtime that is already connected to it. So the
 * runtime is the only thing that *can* apply them, and this is where it does.
 *
 * ## Why this is safe to run on every boot
 *
 * Every statement is idempotent: `ENABLE ROW LEVEL SECURITY` is only issued for
 * a table the catalogue reports RLS-off (on one that has it, it changes nothing
 * and still queues for an ACCESS EXCLUSIVE lock), and each policy is a `DROP
 * POLICY IF EXISTS` immediately followed by a `CREATE POLICY`, so re-applying
 * asserts exactly the declared state. It adds
 * and replaces; it never drops data. (It does not *reconcile* — a policy a
 * previous push left behind under an old name is not removed here; that stays a
 * `db push` / `db migrate` concern, alongside destructive schema changes.)
 *
 * ## A table whose policies are already the declared ones is left alone
 *
 * Every policy this module writes carries a stamp, `COMMENT ON POLICY … IS
 * 'rebase:<hash>'` (see {@link policyStampSql}). The hash covers the
 * `CREATE POLICY` statement that was rendered *and* the definition Postgres
 * stored for it — command, mode, roles, and the deparsed `USING` / `WITH
 * CHECK` — as read back in the same transaction. A boot recomputes it from the
 * statement it would run now and the definition the catalogue holds now, and
 * re-applies a table only when that differs for any of its policies, a declared
 * policy is missing, a superseded one is still there, or RLS is off.
 *
 * So both halves of "the declared state" still win: a rule whose compiled SQL
 * changed (a new rule under the same name, a compiler change) misses on the
 * first half, and a policy someone altered by hand — `ALTER POLICY`, a
 * different role list — misses on the second, and either is re-applied exactly
 * as every boot used to re-apply everything. A boot that changes nothing runs
 * two catalogue reads here, no DDL and takes no table lock. It used to drop and
 * re-create every policy, one ACCESS EXCLUSIVE lock per table: about 1 s at 200
 * collections, and under a `pg_dump` up to the whole retry budget.
 *
 * A policy without a stamp — written by `db push`, by hand, or by a release
 * that predates stamps — counts as different, so the first boot after either
 * re-applies its table once and stamps it. Nothing else reads the comment:
 * drift checks, `doctor`, rls-check and Studio compare names, roles, commands
 * and clauses, never descriptions.
 *
 * Unlike table creation, a failure here is not fatal: RLS stays enabled, so a
 * table whose policies could not be applied fails **closed** (denies) rather
 * than leaking rows. One collection's policy failing (e.g. a rule that
 * references a table a real migration has not created yet) must not crash-loop
 * the whole deployment and take the other collections' working routes down with
 * it. Failures are reported loudly and per-table so the operator can see
 * exactly which collection is not yet servable and why.
 */
import { createHash } from "node:crypto";
import { type CollectionConfig } from "@rebasepro/types";
import { planCollectionPolicies, type CollectionPolicyPlan } from "./generate-postgres-ddl-logic";
import { isGeneratedPolicyName } from "../security/policy-drift";
import { describeDriverError, type Queryable } from "./ensure-collection-tables";
import { assertSafeIdentifier } from "./plan/diff-plan";
import { quoteSqlLiteral } from "./generate-postgres-ddl-logic";
import { revokeUserRoleSql } from "../security/rls-enforcement";
import {
    atomicBatch,
    isLockTimeout,
    isMultiStatementRefusal,
    resolveBootLockOptions,
    sleep,
    type BootLockOptions,
    type ResolvedBootLockOptions
} from "./boot-ddl";

export interface PolicyEnsureResult {
    /** `CREATE POLICY` statements that ran successfully. */
    policiesApplied: number;
    /** Tables that had RLS enabled — including the {@link unchanged} ones, which already had it. */
    tablesSecured: number;
    /**
     * Tables whose policies were already exactly the declared ones, RLS on, by
     * the stamp each policy carries — left alone: no statement, no lock.
     */
    unchanged: number;
    /** Declared tables absent from the database — left to a real migration. */
    skipped: { table: string; reason: string }[];
    /**
     * Tables that have RLS on but did not get every policy. They deny — RLS
     * with no matching policy is deny-all — so they are safe but not servable.
     */
    failures: { table: string; error: string }[];
    /**
     * Tables RLS could not be enabled on, whose DML grant was withdrawn instead.
     *
     * This state had no name, and that was the bug: `ENABLE ROW LEVEL SECURITY`
     * failing was recorded as a `failure` and reported with the same "it stays
     * locked (denies)" wording as a failed policy — but the two are opposites.
     * A policy statement failing leaves RLS on and the table denying. `enableRls`
     * failing leaves RLS *off*, and the schema-wide grant to the user role has
     * already been made by `ensureRlsEnforcement`, so the table is readable and
     * writable by every authenticated request with no row filtering at all.
     */
    unsecured: { table: string; error: string; grantWithdrawn: boolean }[];
    /**
     * Generated policies removed because no current rule produces them.
     *
     * A policy's name embeds a hash of the rule's semantics, so editing a rule
     * does not update a policy — it creates a new one and abandons the old.
     * Postgres ORs permissive policies, so the abandoned one keeps granting:
     * a `USING (true)` tightened to an owner check went on admitting everyone,
     * forever, while the deploy logged success.
     *
     * `db push` reconciles this, and cannot reach a managed tenant's in-cluster
     * database — which is the reason this module exists. So boot has to do it.
     */
    orphansDropped: number;
    /**
     * Tables whose policies were not re-applied because another session held
     * the table's lock for every attempt — a long transaction, a report, a
     * dump. Each table's policy statements run in one transaction, so a table
     * here was left exactly as it was: RLS on, its existing policies in force.
     * `rulesChanged` says whether those differ from the declared ones by name
     * (a rule whose policy is missing, or an orphan still granting), in which
     * case the new rules are not in force on this table until a later boot.
     */
    deferred: { table: string; error: string; rulesChanged: boolean }[];
    /**
     * Tables whose collection declares no rule of its own and which still held
     * generated rule policies, all of them dropped: the generated policies, by
     * name, the boot is to warn about.
     *
     * An edited rule supersedes its old policy, and that drop is the point of
     * {@link PolicyEnsureResult.orphansDropped}. A collection with no rule at
     * all is something else: what a collection looks like when the
     * `defaultSecurityRules` its directory's index declares never reached it —
     * an array handed to a backend without them. Dropping is still right (the
     * declared state wins, and the table is left admin-only rather than open),
     * but it changes who can read the table on every server sharing the
     * database, so it is not done in silence.
     */
    rulesDropped: { table: string; policies: string[] }[];
}

const isCreatePolicy = (statement: string): boolean => /^\s*CREATE POLICY/i.test(statement);

/** The policy names a plan creates. */
const plannedPolicyNames = (plan: CollectionPolicyPlan): Set<string> => {
    const expected = new Set<string>();
    for (const statement of plan.policyStatements) {
        const match = /^\s*CREATE POLICY\s+"([^"]+)"/i.exec(statement);
        if (match) expected.add(match[1]);
    }
    return expected;
};

/**
 * Generated policies on this table that the current plan does not produce.
 *
 * Scoped hard, because dropping a policy is destructive: only this one table,
 * only names matching the generated `<table>_<op>_<sha1>` shape, and only names
 * absent from the plan. A hand-written policy, or one belonging to another
 * table, is never touched — `isGeneratedPolicyName` is the same predicate `db
 * push` uses to draw that line.
 *
 * Computed from the names read before anything is applied. The plan only ever
 * drops and re-creates its own names, so "present before, not planned" is the
 * same set the old read-after-apply found.
 */
const orphansOf = (plan: CollectionPolicyPlan, present: readonly string[]): string[] => {
    const expected = plannedPolicyNames(plan);
    return present.filter(name => !expected.has(name) && isGeneratedPolicyName(name, plan.table));
};

const dropPolicySql = (plan: CollectionPolicyPlan, name: string): string =>
    `DROP POLICY IF EXISTS "${name}" ON "${plan.schema}"."${plan.table}"`;

/** What every policy stamp starts with. See {@link policyStampSql}. */
export const POLICY_STAMP_PREFIX = "rebase:";

const sha256Hex = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/** The same digest, computed by Postgres: hex SHA-256 of the text's UTF-8 bytes. */
const sha256Sql = (expression: string): string => `encode(sha256(convert_to(${expression}, 'UTF8')), 'hex')`;

/**
 * The definition Postgres holds for the `pg_policy` row aliased `p`, as one
 * text: command, permissive/restrictive, the role OIDs, and the deparsed
 * `USING` and `WITH CHECK` (`-` for an absent clause, so absent and empty
 * differ). Everything `ALTER POLICY` can change, and everything a `CREATE
 * POLICY` sets.
 *
 * Read back with `pg_get_expr`, whose spelling depends on `search_path` (a
 * name on the path prints unqualified). The stamp is written and checked by
 * the same boot connections, so the two agree; a process with a different
 * path would only disagree, and re-apply — what every boot did before stamps.
 */
const liveDefinitionSql = (p: string): string =>
    `concat_ws(E'\\n', ${p}.polcmd::text, ${p}.polpermissive::text, ${p}.polroles::text, ` +
    `coalesce(pg_get_expr(${p}.polqual, ${p}.polrelid), '-'), ` +
    `coalesce(pg_get_expr(${p}.polwithcheck, ${p}.polrelid), '-'))`;

/** The stamp a policy rendered as `renderedHash` carries when its stored definition hashes to `liveHash`. */
const stampOf = (renderedHash: string, liveHash: string): string =>
    `${POLICY_STAMP_PREFIX}${sha256Hex(`${renderedHash}:${liveHash}`)}`;

/** The policies a plan creates, by name, each with the hash of its `CREATE POLICY` statement. */
const renderedHashes = (plan: CollectionPolicyPlan): Map<string, string> => {
    const hashes = new Map<string, string>();
    for (const statement of plan.policyStatements) {
        const match = /^\s*CREATE POLICY\s+"([^"]+)"/i.exec(statement);
        if (match) hashes.set(match[1], sha256Hex(statement.trim()));
    }
    return hashes;
};

/**
 * One statement that stamps every policy the plan just created on its table:
 * `COMMENT ON POLICY … IS 'rebase:<hash>'`, the hash taken over the rendered
 * statement's hash and the definition Postgres stored — read back here, after
 * the `CREATE`s, in the same transaction. A `DO` block because the stored
 * definition is only known once the policy exists, and a `COMMENT` takes a
 * literal. One line, and it names only this table.
 *
 * `undefined` for a table the plan gives no policies.
 */
export function policyStampSql(plan: CollectionPolicyPlan): string | undefined {
    const hashes = renderedHashes(plan);
    if (hashes.size === 0) return undefined;
    const target = `"${plan.schema}"."${plan.table}"`;
    const values = [...hashes].map(([name, hash]) => `(${quoteSqlLiteral(name)}, '${hash}')`).join(", ");
    const stamp = `${quoteSqlLiteral(POLICY_STAMP_PREFIX)} || ${sha256Sql(`s.rendered || ':' || ${sha256Sql(liveDefinitionSql("p"))}`)}`;
    return "DO $rebase_policy_stamp$ DECLARE r record; BEGIN " +
        `FOR r IN SELECT p.polname AS name, ${stamp} AS stamp FROM pg_policy p ` +
        `JOIN (VALUES ${values}) AS s(name, rendered) ON s.name = p.polname ` +
        `WHERE p.polrelid = ${quoteSqlLiteral(target)}::regclass LOOP ` +
        `EXECUTE 'COMMENT ON POLICY ' || quote_ident(r.name) || ${quoteSqlLiteral(` ON ${target} IS `)} || quote_literal(r.stamp); ` +
        "END LOOP; END $rebase_policy_stamp$;";
}

/** One policy as the catalogue has it. */
interface LivePolicy {
    /** Its comment — a stamp, when this module wrote it. */
    stamp: string | null;
    /** Hex SHA-256 of {@link liveDefinitionSql}. */
    live: string;
}

/**
 * Every policy on every table in the declared schemas — name, stamp and a hash
 * of its stored definition — in one read. It replaced a `pg_policies` query
 * per table, and later the name-only read that preceded stamps.
 */
async function readLivePolicies(client: Queryable, schemas: string[]): Promise<Map<string, Map<string, LivePolicy>>> {
    const policies = new Map<string, Map<string, LivePolicy>>();
    if (schemas.length === 0) return policies;
    const inList = schemas.map(schema => `'${assertSafeIdentifier(schema, "schema name")}'`).join(", ");
    const { rows } = await client.query<{
        schemaname: string; tablename: string; policyname: string; stamp?: string | null; live?: string | null;
    }>(
        `SELECT n.nspname AS schemaname, c.relname AS tablename, p.polname AS policyname,
                obj_description(p.oid, 'pg_policy') AS stamp, ${sha256Sql(liveDefinitionSql("p"))} AS live
         FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname IN (${inList})`
    );
    for (const row of rows) {
        const key = `${row.schemaname}.${row.tablename}`;
        if (!policies.has(key)) policies.set(key, new Map());
        policies.get(key)!.set(row.policyname, { stamp: row.stamp ?? null, live: row.live ?? "" });
    }
    return policies;
}

/**
 * Whether every policy the plan declares is on the table, stamped for exactly
 * the statement the plan would run and exactly the definition it holds now.
 */
const policiesAreCurrent = (plan: CollectionPolicyPlan, present: Map<string, LivePolicy>): boolean => {
    for (const [name, renderedHash] of renderedHashes(plan)) {
        const policy = present.get(name);
        if (!policy || policy.stamp !== stampOf(renderedHash, policy.live)) return false;
    }
    return true;
};

/**
 * What its stamp says of a declared policy the database has: written by Rebase
 * from the statement the plan renders now and still holding that definition
 * (`current`), stamped once but changed since — the rule's SQL, or the policy
 * by hand (`stale`), or carrying no stamp at all, so nothing tells whether a
 * re-apply changes it (`unstamped`).
 */
export type PolicyStampState = "current" | "stale" | "unstamped";

/**
 * Every declared policy the database holds, by `schema.table`, then name, with
 * its {@link PolicyStampState}. The comparison a boot makes to leave a table
 * alone, read for each policy instead of each table.
 *
 * The stored definition is read with `pg_get_expr`, whose spelling depends on
 * `search_path`: call it under the path the stamps were written under (a
 * boot's, `public` unless the URL pins one), or a current stamp reads stale.
 */
export async function readPolicyStamps(
    client: Queryable,
    collections: CollectionConfig[]
): Promise<Map<string, Map<string, PolicyStampState>>> {
    const plans = planCollectionPolicies(collections);
    const live = await readLivePolicies(client, Array.from(new Set(plans.map(p => p.schema))));
    const states = new Map<string, Map<string, PolicyStampState>>();
    for (const plan of plans) {
        const present = live.get(plan.qualified);
        if (!present) continue;
        const table = new Map<string, PolicyStampState>();
        for (const [name, renderedHash] of renderedHashes(plan)) {
            const policy = present.get(name);
            if (!policy) continue;
            table.set(name, policy.stamp === null || !policy.stamp.startsWith(POLICY_STAMP_PREFIX)
                ? "unstamped"
                : policy.stamp === stampOf(renderedHash, policy.live) ? "current" : "stale");
        }
        states.set(plan.qualified, table);
    }
    return states;
}

/** The name a probed policy is made under, in a transaction nothing commits. */
const PROBE_POLICY = "rebase_policy_probe";

/**
 * For each of `policies`, whether the `CREATE POLICY` the plan renders for it
 * stores the definition the database holds now: made under a probe name on
 * the same table, read back, compared with the one there, and rolled back.
 *
 * What a stamp cannot answer. A stamp covers the statement as rendered, so a
 * rule whose text differs from the one that made the policy reads as changed
 * though Postgres would store the same thing: `schema introspect` writes a role
 * rule back as its deparsed SQL, and every such policy was planned as a
 * replacement of itself. A policy `db migrate` created has no stamp at all.
 *
 * One short transaction per policy, which takes the table's lock for as long
 * as it lasts and gives up on it after two seconds. A policy that could not be
 * probed — no statement for it, a lock not granted, a rule that does not
 * parse — is left out of the answer, and the caller keeps what the stamp said.
 * Keyed `schema.table.name`.
 */
export async function probeRenderedPolicies(
    client: Queryable,
    collections: CollectionConfig[],
    policies: readonly { schema: string; table: string; name: string }[],
    options: { searchPath?: string } = {}
): Promise<Map<string, boolean>> {
    const statements = new Map<string, string>();
    for (const plan of planCollectionPolicies(collections)) {
        for (const statement of plan.policyStatements) {
            const match = /^\s*CREATE POLICY\s+"([^"]+)"/i.exec(statement);
            if (match) statements.set(`${plan.schema}.${plan.table}.${match[1]}`, statement.trim());
        }
    }
    const answers = new Map<string, boolean>();
    for (const policy of policies) {
        const key = `${policy.schema}.${policy.table}.${policy.name}`;
        const statement = statements.get(key);
        if (!statement) continue;
        const probe = statement.replace(/^(\s*CREATE POLICY\s+)"[^"]+"/i, `$1"${PROBE_POLICY}"`);
        const target = `"${policy.schema.replace(/"/g, '""')}"."${policy.table.replace(/"/g, '""')}"`;
        // Literals rather than parameters: a boot's `Queryable` takes none.
        const definition = (name: string): string =>
            `(SELECT ${liveDefinitionSql("p")} FROM pg_policy p ` +
            `WHERE p.polrelid = ${quoteSqlLiteral(target)}::regclass AND p.polname = ${quoteSqlLiteral(name)})`;
        try {
            await client.query("BEGIN");
            await client.query("SET LOCAL lock_timeout = '2s'");
            if (options.searchPath) await client.query(`SET LOCAL search_path TO ${options.searchPath}`);
            await client.query(probe);
            const { rows } = await client.query<{ same: boolean | null }>(
                `SELECT ${definition(PROBE_POLICY)} IS NOT DISTINCT FROM ${definition(policy.name)} AS same`
            );
            if (typeof rows[0]?.same === "boolean") answers.set(key, rows[0].same);
        } catch {
            // Not probed; see above.
        } finally {
            await client.query("ROLLBACK").catch(() => undefined);
        }
    }
    return answers;
}

/**
 * Every declared schema's tables, and whether each has row-level security on.
 *
 * One catalogue read for the whole step. It replaced a full `readExistingSchema`
 * — eight catalogue queries and a row probe of every table, of which only the
 * table names were used — and it carries the one fact that lets a boot leave an
 * already-locked table alone: `relrowsecurity`.
 *
 * Presence is still decided by `information_schema.columns`, as it was: the
 * same relations (views included, which have no RLS and are closed by revoking,
 * exactly as before) and the same privilege filter.
 */
async function readTableSecurity(client: Queryable, schemas: string[]): Promise<Map<string, { rls: boolean }>> {
    const tables = new Map<string, { rls: boolean }>();
    if (schemas.length === 0) return tables;
    const inList = schemas.map(schema => `'${assertSafeIdentifier(schema, "schema name")}'`).join(", ");
    const { rows } = await client.query<{ table_schema: string; table_name: string; rls: boolean | null }>(
        `SELECT t.table_schema, t.table_name, c.relrowsecurity AS rls
         FROM (SELECT DISTINCT table_schema, table_name FROM information_schema.columns
               WHERE table_schema IN (${inList})) t
         JOIN pg_namespace n ON n.nspname = t.table_schema
         JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = t.table_name`
    );
    for (const row of rows) tables.set(`${row.table_schema}.${row.table_name}`, { rls: row.rls === true });
    return tables;
}

/**
 * Whether the catalogue says RLS is on for one table, read fresh. `false` when
 * it cannot be read, which sends the caller down the fail-closed path.
 */
async function rlsIsOn(client: Queryable, plan: CollectionPolicyPlan): Promise<boolean> {
    try {
        const { rows } = await client.query<{ rls: boolean }>(
            `SELECT c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = ${quoteSqlLiteral(plan.schema)} AND c.relname = ${quoteSqlLiteral(plan.table)}`
        );
        return rows[0]?.rls === true;
    } catch {
        return false;
    }
}

/** What one table's `ENABLE ROW LEVEL SECURITY` came to. */
type TableLock =
    | { locked: true }
    | { locked: false; error: string; grantWithdrawn: boolean };

/**
 * Switch RLS on for one table, or — when Postgres refuses — take the user
 * role's privileges on it back, so the table is unreachable rather than
 * unprotected.
 *
 * A table the catalogue already reports RLS-on is left alone. `ENABLE` on it
 * changes nothing, and it is not free: it queues for an `ACCESS EXCLUSIVE` lock,
 * so a boot that met a long reader held every live query on that table behind
 * it — and when the wait ended in a timeout, the catch below revoked the user
 * role's privileges on a table that had been protected all along. Every
 * replica shares the grants, so one boot during a `pg_dump` closed the
 * collection for the whole deployment until the next clean boot.
 */
async function lockTable(
    client: Queryable,
    plan: CollectionPolicyPlan,
    rlsOn: boolean,
    run: (sql: string) => Promise<unknown> = sql => client.query(sql)
): Promise<TableLock> {
    if (rlsOn) return { locked: true };
    try {
        await run(plan.enableRls);
        return { locked: true };
    } catch (err) {
        // The database's own answer, not the ORM's wrapper — see
        // `describeDriverError`. This is the most consequential message in
        // the file: it is what the operator reads about a table that is now
        // denying every request, and `Failed query: <the statement>` told
        // them nothing they did not already have.
        const error = describeDriverError(err);
        // A failed statement says nothing about the state it meant to reach: a
        // lock or statement timeout, a cancelled query, a peer that enabled it
        // first. Ask the catalogue. Only a table that really is RLS-off is
        // revoked — that safety is unchanged; a read that fails counts as off.
        if (await rlsIsOn(client, plan)) return { locked: true };
        // Take the privilege back rather than serve an unprotected table.
        // This is the fail-closed step the old code assumed it already had:
        // per-table, so one collection cannot take the rest of the
        // deployment down, but leaving nothing readable without RLS.
        //
        // Quoted, like every other statement here: unquoted, Postgres folds
        // the name to lower case, so a mixed-case adopted table (`"User"`)
        // was revoked as `public.user` — which fails, and a table that could
        // have been closed refused the boot instead.
        return withdrawGrant(client, plan, error);
    }
}

/**
 * Take the user role's privileges on a table back, so an RLS-off table is
 * unreachable rather than unprotected. `REVOKE` waits for no table lock a
 * reader holds, so it runs as a plain statement.
 */
async function withdrawGrant(client: Queryable, plan: CollectionPolicyPlan, error: string): Promise<TableLock> {
    try {
        await client.query(revokeUserRoleSql(plan.schema, plan.table));
        return { locked: false, error, grantWithdrawn: true };
    } catch {
        // Reported with `grantWithdrawn: false`, which the caller escalates.
        // There is nothing else this can do to make the table safe.
        return { locked: false, error, grantWithdrawn: false };
    }
}

export interface TableLockResult {
    /** Tables RLS is now on for. */
    locked: number;
    /** Tables it could not be switched on for. See {@link PolicyEnsureResult.unsecured}. */
    unsecured: PolicyEnsureResult["unsecured"];
}

/**
 * Switch RLS on for every table the collections declare — each collection's
 * and each junction's — and do nothing else.
 *
 * The first thing `rebase db push` does once Atlas has committed. Atlas cannot
 * carry `ENABLE ROW LEVEL SECURITY` (its free tier neither plans nor reads it),
 * so a table it creates arrives with RLS off — while the user role already
 * holds DML on it through the schema's default privileges. Everything push runs
 * after Atlas can refuse: the vector, search and trigger DDL, the policies
 * themselves. Locking first means none of those failures can leave a table
 * open: RLS with no policy denies, which is a state a failed push may leave.
 *
 * A declared table that is not in the database is skipped — nothing can reach
 * a table that does not exist, and the step that creates it locks it.
 */
export async function lockCollectionTables(
    client: Queryable,
    collections: CollectionConfig[]
): Promise<TableLockResult> {
    const result: TableLockResult = { locked: 0, unsecured: [] };
    for (const { plan, rls } of await declaredTablesPresent(client, collections)) {
        const lock = await lockTable(client, plan, rls);
        if (lock.locked) {
            result.locked++;
        } else {
            result.unsecured.push({ table: plan.qualified, error: lock.error, grantWithdrawn: lock.grantWithdrawn });
        }
    }
    return result;
}

/**
 * The declared tables {@link lockCollectionTables} would switch row-level
 * security on for: those in the database with it off. What `db push
 * --dry-run` lists, read the way the push's lock step reads it.
 */
export async function tablesRlsWouldEnable(client: Queryable, collections: CollectionConfig[]): Promise<string[]> {
    return (await declaredTablesPresent(client, collections)).filter(table => !table.rls).map(table => table.plan.qualified);
}

/** Each declared table the database has, with whether its RLS is on. */
async function declaredTablesPresent(
    client: Queryable,
    collections: CollectionConfig[]
): Promise<{ plan: CollectionPolicyPlan; rls: boolean }[]> {
    const plans = planCollectionPolicies(collections);
    if (plans.length === 0) return [];
    const tables = await readTableSecurity(client, Array.from(new Set(plans.map(p => p.schema))));
    return plans.flatMap(plan => {
        const table = tables.get(plan.qualified);
        return table ? [{ plan, rls: table.rls }] : [];
    });
}

/** One declared table that exists, and what the catalogue said about it. */
interface TableWork {
    plan: CollectionPolicyPlan;
    rlsOn: boolean;
    orphans: string[];
    /** Whether the policy names on the table differ from the plan's. */
    rulesChanged: boolean;
    /** Whether the plan holds no generated rule of its own, so the orphans are every rule the table had. */
    declaresNoRule: boolean;
}

type AtomicOutcome =
    | { kind: "applied" }
    | { kind: "lock-timeout"; error: string }
    | { kind: "unsupported" }
    | { kind: "failed"; error: string };

/**
 * Bring the declared collections' RLS policies up to date. Returns what it did.
 *
 * Only tables that already exist are touched: the boot-time table creator runs
 * first, so anything still missing is a table this additive path did not
 * create (it creates junctions too) — one a failed boot DDL left out, or a
 * project whose schema a migration owns. Enabling RLS on a
 * non-existent table would error, so those are recorded as skipped, not failed.
 *
 * ## One transaction per table
 *
 * Each table's statements — `ENABLE` when RLS is off, every `DROP POLICY IF
 * EXISTS` / `CREATE POLICY` pair, the orphan drops — go to Postgres as one
 * string, which it runs as one transaction (see `boot-ddl`). Before, each was
 * its own autocommit: at 240 tables, 4,080 commits and 4,080 ACCESS EXCLUSIVE
 * lock acquisitions per boot, 6–22 s on a disk that really flushes. And between
 * a policy's DROP and its CREATE, every other replica evaluated the table with
 * that policy missing — a user's continuous reads of their own row came back
 * empty once per boot (measured, Postgres 18). Now a concurrent request sees the
 * old policies or the new ones, never neither.
 *
 * If the transaction fails for any reason but a lock timeout, the table is
 * applied again one statement at a time, exactly as before — so a rule that
 * cannot be created (a function a migration has not added yet) leaves the
 * table in the same deny-leaning partial state it always did, rather than
 * rolling back to the old, possibly looser, policies.
 *
 * ## Lock budget
 *
 * The transaction runs under `lock_timeout` (`boot-ddl`), so a table that a
 * long transaction, a report or a dump is holding costs live traffic one
 * second, not the statement timeout. A contended table is retried after the
 * others, with backoff, within a retry budget for the whole step; one still
 * held after that is reported in `deferred` — its transaction rolled back, so
 * it is exactly as it was before this boot — or, if RLS was off on it, closed
 * by revoking the user role's grant, as any table RLS cannot be enabled on is.
 */
export async function ensureCollectionPolicies(
    client: Queryable,
    collections: CollectionConfig[],
    log?: (message: string) => void,
    options: BootLockOptions = {}
): Promise<PolicyEnsureResult> {
    const result: PolicyEnsureResult = {
        policiesApplied: 0, tablesSecured: 0, unchanged: 0, skipped: [], failures: [], unsecured: [],
        orphansDropped: 0, deferred: [], rulesDropped: []
    };

    const plans = planCollectionPolicies(collections);
    if (plans.length === 0) return result;
    const lock = resolveBootLockOptions(options);

    const schemas = Array.from(new Set(plans.map(p => p.schema)));
    const tables = await readTableSecurity(client, schemas);
    const livePolicies = await readLivePolicies(client, schemas);

    const work: TableWork[] = [];
    for (const plan of plans) {
        const table = tables.get(plan.qualified);
        if (!table) {
            result.skipped.push({
                table: plan.qualified,
                reason: "table is not present in the database; create it with `rebase db push` / `rebase db migrate`"
            });
            continue;
        }
        const live = livePolicies.get(plan.qualified) ?? new Map<string, LivePolicy>();
        const present = [...live.keys()];
        const orphans = orphansOf(plan, present);
        // Already exactly what the plan would leave: nothing to run, no lock to take.
        if (table.rls && orphans.length === 0 && policiesAreCurrent(plan, live)) {
            result.tablesSecured++;
            result.unchanged++;
            continue;
        }
        const presentSet = new Set(present);
        const rulesChanged = orphans.length > 0 || [...plannedPolicyNames(plan)].some(name => !presentSet.has(name));
        const declaresNoRule = ![...plannedPolicyNames(plan)].some(name => isGeneratedPolicyName(name, plan.table));
        work.push({ plan, rlsOn: table.rls, orphans, rulesChanged, declaresNoRule });
    }
    if (result.unchanged > 0) {
        log?.(`${result.unchanged} table(s) already have exactly the declared policies; left as they are`);
    }

    // Until the handle refuses a multi-statement string (an extended-protocol
    // driver), after which every table goes one statement at a time.
    let atomic = true;
    let retryBudget = lock.retryBudgetMs;
    let queue = work;
    let lastError = new Map<TableWork, string>();

    for (let attempt = 1; queue.length > 0; attempt++) {
        if (attempt > 1) {
            if (attempt > lock.attempts || retryBudget <= 0) break;
            await sleep(lock.backoffMs(attempt - 1));
        }
        const contended: TableWork[] = [];
        const errors = new Map<TableWork, string>();
        for (const table of queue) {
            if (attempt > 1 && retryBudget <= 0) {
                contended.push(table);
                errors.set(table, lastError.get(table) ?? "");
                continue;
            }
            if (atomic) {
                const outcome = await applyAtomically(client, table, lock);
                if (outcome.kind === "applied") {
                    record(result, table, log);
                    continue;
                }
                if (outcome.kind === "lock-timeout") {
                    if (attempt > 1) retryBudget -= lock.lockTimeoutMs;
                    contended.push(table);
                    errors.set(table, outcome.error);
                    continue;
                }
                if (outcome.kind === "unsupported") {
                    atomic = false;
                } else {
                    log?.(`${table.plan.qualified}: applying its policies in one transaction failed ` +
                        `(${outcome.error}); applying them one statement at a time`);
                }
            }
            await applyEachStatement(client, table, result, log, atomic ? lock : undefined);
        }
        queue = contended;
        lastError = errors;
    }

    // Still contended after every attempt the budget allowed.
    for (const table of queue) {
        await giveUp(client, table, lastError.get(table) ?? "", lock, result);
    }

    return result;
}

/**
 * The table's statements, in the order they must run — the stamp last, so it
 * reads back the policies this same transaction created.
 */
const statementsOf = (table: TableWork): string[] => {
    const stamp = policyStampSql(table.plan);
    return [
        ...(table.rlsOn ? [] : [table.plan.enableRls]),
        ...table.plan.policyStatements,
        ...table.orphans.map(name => dropPolicySql(table.plan, name)),
        ...(stamp ? [stamp] : [])
    ];
};

async function applyAtomically(
    client: Queryable,
    table: TableWork,
    lock: ResolvedBootLockOptions
): Promise<AtomicOutcome> {
    const statements = statementsOf(table);
    if (statements.length === 0) return { kind: "applied" };
    try {
        await client.query(atomicBatch(statements, lock.lockTimeoutMs));
        return { kind: "applied" };
    } catch (err) {
        if (isLockTimeout(err)) return { kind: "lock-timeout", error: describeDriverError(err) };
        if (isMultiStatementRefusal(err)) return { kind: "unsupported" };
        return { kind: "failed", error: describeDriverError(err) };
    }
}

/**
 * The warning a boot gives for one entry of {@link PolicyEnsureResult.rulesDropped}:
 * each policy, what it means for the table, and the likely cause.
 */
export function describeRulesDropped(dropped: { table: string; policies: string[] }): string {
    return `🔐 [rls] "${dropped.table}" declares no securityRules, so the policies its rules had made were dropped: ` +
        `${dropped.policies.join(", ")}. Only administrators reach its rows now, on every server sharing this database. ` +
        "If its collection came in an array handed to createRebaseBackend, that array lacked the defaultSecurityRules " +
        "its config/collections/index.ts declares: pass collectionsDir, or the array that index exports, which carries " +
        "them. If the rules were removed on purpose, this is that change.";
}

/** The orphans just dropped, when they were every rule the table had. See {@link PolicyEnsureResult.rulesDropped}. */
function recordRulesDropped(result: PolicyEnsureResult, table: TableWork): void {
    if (table.declaresNoRule && table.orphans.length > 0) {
        result.rulesDropped.push({ table: table.plan.qualified, policies: [...table.orphans].sort() });
    }
}

function record(result: PolicyEnsureResult, table: TableWork, log?: (message: string) => void): void {
    const created = table.plan.policyStatements.filter(isCreatePolicy).length;
    result.tablesSecured++;
    result.policiesApplied += created;
    result.orphansDropped += table.orphans.length;
    recordRulesDropped(result, table);
    log?.(`${table.plan.qualified}: RLS enabled, ${created} policy(ies) applied` +
        (table.orphans.length > 0 ? `, ${table.orphans.length} orphan(s) dropped` : ""));
}

/**
 * The table applied one statement at a time — the path every table took before
 * the per-table transaction, kept as its fallback so a failure ends exactly
 * where it always did.
 *
 * Each statement still carries the lock budget when the handle can take it.
 */
async function applyEachStatement(
    client: Queryable,
    table: TableWork,
    result: PolicyEnsureResult,
    log: ((message: string) => void) | undefined,
    lock: ResolvedBootLockOptions | undefined
): Promise<void> {
    const { plan } = table;
    const run = (sql: string) => client.query(lock ? atomicBatch([sql], lock.lockTimeoutMs) : sql);

    // Enabling RLS is its own step, because its failure is the opposite of
    // every other failure here. Once RLS is on, anything that goes wrong
    // afterwards leaves the table denying; while it is off, the grant made
    // earlier in boot leaves the table wide open. Sharing one `try` meant
    // the dangerous case was reported in the safe case's words.
    const locked = await lockTable(client, plan, table.rlsOn, run);
    if (!locked.locked) {
        result.unsecured.push({ table: plan.qualified, error: locked.error, grantWithdrawn: locked.grantWithdrawn });
        return;
    }
    result.tablesSecured++;

    try {
        let created = 0;
        for (const statement of plan.policyStatements) {
            await run(statement);
            if (isCreatePolicy(statement)) {
                result.policiesApplied++;
                created++;
            }
        }
        for (const name of table.orphans) {
            await run(dropPolicySql(plan, name));
            result.orphansDropped++;
        }
        recordRulesDropped(result, table);
        log?.(`${plan.qualified}: RLS enabled, ${created} policy(ies) applied` +
            (table.orphans.length > 0 ? `, ${table.orphans.length} orphan(s) dropped` : ""));
    } catch (err) {
        result.failures.push({
            table: plan.qualified,
            error: describeDriverError(err)
        });
        return;
    }

    // Only once every policy is in. A stamp that cannot be written costs the
    // next boot a re-apply of this table — what every boot did before stamps —
    // so it is reported, not failed.
    const stamp = policyStampSql(plan);
    if (!stamp) return;
    try {
        await run(stamp);
    } catch (err) {
        log?.(`${plan.qualified}: policies applied, but not stamped (${describeDriverError(err)}); ` +
            "the next boot applies them again");
    }
}

/**
 * A table whose lock was held for every attempt. Its transaction rolled back
 * each time, so it is exactly as it was before this boot.
 *
 * With RLS on, that is a safe state to leave it in — reported, not failed. With
 * RLS off it is an open table over the schema-wide grant, so it is closed the
 * way any table RLS cannot be enabled on is: the catalogue is asked once more,
 * and only a table that really is RLS-off has the user role's grant withdrawn.
 */
async function giveUp(
    client: Queryable,
    table: TableWork,
    lastError: string,
    lock: ResolvedBootLockOptions,
    result: PolicyEnsureResult
): Promise<void> {
    const { plan } = table;
    const error =
        `another session held the table's lock for every attempt (lock_timeout ${lock.lockTimeoutMs} ms` +
        `${lastError ? `: ${lastError.split("\n")[0]}` : ""}) — a long transaction, a report or a dump`;
    if (table.rlsOn || await rlsIsOn(client, plan)) {
        result.tablesSecured++;
        result.deferred.push({ table: plan.qualified, error, rulesChanged: table.rulesChanged });
        return;
    }
    const closed = await withdrawGrant(client, plan, error);
    if (!closed.locked) {
        result.unsecured.push({ table: plan.qualified, error: closed.error, grantWithdrawn: closed.grantWithdrawn });
    }
}
