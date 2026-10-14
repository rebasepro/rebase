import { LEGACY_RLS_SCHEMA, REBASE_SCHEMA } from "@rebasepro/types";
import { sqlRows } from "@rebasepro/common";

/**
 * Canonical SQL bootstrap for the RLS helper functions.
 *
 * Generated RLS policies reference `rebase.uid()` / `rebase.roles()` /
 * `rebase.jwt()`, so any SQL stream that can contain policies must be
 * self-contained: it has to (re)create these helpers first. This matters for
 * the migration directory in particular — Atlas replays migrations against a
 * clean dev database where no out-of-band bootstrap has ever run, so a
 * migration carrying policies without this preamble fails with
 * "function rebase.uid() does not exist".
 *
 * Idempotent (`IF NOT EXISTS` / `OR REPLACE`) so it can be prepended to every
 * policies block and re-applied freely. The runtime boot path
 * (`auth/ensure-tables.ts`) creates the same functions under an advisory lock
 * for HMR-safety; keep the definitions in sync.
 *
 * ## Creating the `rebase` schema here is now safe, and required
 *
 * It deliberately did not, once. These functions lived in a schema called
 * `auth`, and the note here read: creating `rebase` would leak it into Atlas's
 * replayed migration state, and — absent from the desired `schema.sql` — Atlas
 * would then plan `DROP SCHEMA "rebase" CASCADE`, taking the auth tables with
 * it. That reasoning still holds; what changed is the second half of it. The
 * DDL generator now emits `CREATE SCHEMA IF NOT EXISTS "rebase"`
 * unconditionally, so the schema is always in the desired state and the diff is
 * empty. (It used to appear only when some collection happened to declare
 * `schema: "rebase"` — true for the scaffold's users collection, and not a
 * property anything guaranteed.) `db push` additionally excludes the whole
 * schema from the declarative apply.
 *
 * See `@rebasepro/types`' `rls-functions` for why the functions moved out of
 * `auth` at all: the short version is that the name was Supabase's, and
 * `CREATE OR REPLACE FUNCTION auth.uid() RETURNS text` cannot be applied over
 * Supabase's `RETURNS uuid` — Postgres refuses, and the refusal used to be
 * swallowed.
 */
/**
 * The bootstrap as individual statements.
 *
 * Kept as an array because the two consumers need different shapes and only one
 * of them can take a multi-command string: the migration preamble is written to
 * a file and replayed by Atlas, but the boot path runs through drizzle, whose
 * node-postgres handle speaks the extended query protocol and rejects more than
 * one command per call. Splitting a joined string back apart on `$$;` would be
 * a parser for a problem that does not need one.
 */
export const RLS_BOOTSTRAP_STATEMENTS: readonly string[] = [
    `CREATE SCHEMA IF NOT EXISTS ${REBASE_SCHEMA}`,

    // Falls back to the pre-rename `app.user_id` so a database that has taken
    // the new schema but is still served by an older backend keeps resolving
    // the principal. Drop the COALESCE once no such deployment remains.
    `CREATE OR REPLACE FUNCTION ${REBASE_SCHEMA}.uid() RETURNS text AS $$
    SELECT COALESCE(
        NULLIF(current_setting('app.uid', true), ''),
        NULLIF(current_setting('app.user_id', true), '')
    );
$$ LANGUAGE sql STABLE`,

    `CREATE OR REPLACE FUNCTION ${REBASE_SCHEMA}.jwt() RETURNS jsonb AS $$
    SELECT COALESCE(
        NULLIF(current_setting('app.jwt', true), ''),
        '{}'
    )::jsonb;
$$ LANGUAGE sql STABLE`,

    `CREATE OR REPLACE FUNCTION ${REBASE_SCHEMA}.roles() RETURNS text AS $$
    SELECT COALESCE(NULLIF(current_setting('app.user_roles', true), ''), '');
$$ LANGUAGE sql STABLE`,

    // Is the caller a GUEST — signed in through anonymous sign-in rather than
    // with an account?
    //
    // Anonymous sign-in mints a real user row and a real uid, so inside a policy
    // a guest was indistinguishable from a registered account: same `uid()`
    // shape, same default role. Every rule meaning "a signed-in person" was
    // therefore also a rule about anybody who had called
    // `POST /auth/anonymous`, which needs no email, no password and no consent
    // to anything. On a deployment with anonymous sign-in enabled, that is the
    // whole internet holding a session.
    //
    // The fact exists on the user row (`is_anonymous`) and simply never reached
    // the database's own identity. Now it does, and a policy can say
    // `NOT rebase.is_anonymous()`.
    //
    // Defaults to FALSE when the GUC is unset, which is the safe direction:
    // an older backend against a newer database leaves it unset, and reading
    // that as "not a guest" preserves exactly the behaviour that deployment
    // already had rather than locking its users out.
    `CREATE OR REPLACE FUNCTION ${REBASE_SCHEMA}.is_anonymous() RETURNS boolean AS $$
    SELECT COALESCE(NULLIF(current_setting('app.is_anonymous', true), ''), 'false')::boolean;
$$ LANGUAGE sql STABLE`
];

/** Everything `CREATE OR REPLACE FUNCTION` sets on a function, as one comparable string. */
const describeFunction = (facts: {
    returns: string; language: string; volatility: string; strict: boolean; parallel: string;
    securityDefiner: boolean; leakproof: boolean; cost: number; hasConfig: boolean; body: string;
}): string => JSON.stringify([
    facts.returns.toLowerCase(), facts.language.toLowerCase(), facts.volatility, facts.strict, facts.parallel,
    facts.securityDefiner, facts.leakproof, facts.cost, facts.hasConfig, facts.body
]);

/**
 * What each `CREATE OR REPLACE FUNCTION` in {@link RLS_BOOTSTRAP_STATEMENTS}
 * would leave in the catalogue, by `schema.name`. Parsed
 * from the statements themselves, so the two cannot drift; a statement this
 * does not recognise makes {@link rlsRuntimeIsCurrent} answer "no", and the
 * bootstrap runs as it always did.
 */
const expectedRlsFunctions = (): Map<string, string> | undefined => {
    const expected = new Map<string, string>();
    for (const statement of RLS_BOOTSTRAP_STATEMENTS) {
        if (/^CREATE SCHEMA IF NOT EXISTS /.test(statement)) continue;
        const match = /^CREATE OR REPLACE FUNCTION (\w+)\.(\w+)\(\) RETURNS (\w+) AS \$\$([\s\S]*)\$\$ LANGUAGE (\w+) (IMMUTABLE|STABLE|VOLATILE)$/
            .exec(statement);
        if (!match) return undefined;
        const [, schema, name, returns, body, language, volatility] = match;
        expected.set(`${schema}.${name}`, describeFunction({
            returns, language, volatility: volatility[0].toLowerCase(), strict: false, parallel: "u",
            securityDefiner: false, leakproof: false, cost: 100, hasConfig: false, body
        }));
    }
    return expected;
};

/**
 * Whether the `rebase` schema and every RLS helper function are exactly what
 * {@link RLS_BOOTSTRAP_STATEMENTS} would make them — one catalogue read.
 *
 * The boot ran those statements unconditionally, on every boot and on every
 * source: four `CREATE OR REPLACE FUNCTION`s in a transaction under an
 * advisory lock. Replacing a function rewrites its `pg_proc` row even when
 * nothing changed, and every cached plan that inlined it — every plan of every
 * statement a policy applies to, on every connection — is invalidated by it.
 * A function that differs in anything `CREATE OR REPLACE` sets (body,
 * language, volatility, strictness, parallel safety, security, leakproofness,
 * cost, `SET` options), or is missing, answers `false`, and the statements run
 * as before.
 */
export async function rlsRuntimeIsCurrent(run: (sql: string) => Promise<Record<string, unknown>[]>): Promise<boolean> {
    const expected = expectedRlsFunctions();
    if (!expected) return false;
    const names = [...expected.keys()].map(key => key.split("."));
    const rows = await run(
        `SELECT n.nspname AS schema, p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args,
                format_type(p.prorettype, NULL) AS returns, l.lanname AS language,
                p.provolatile::text AS volatility, p.proisstrict AS strict, p.proparallel::text AS parallel,
                p.prosecdef AS security_definer, p.proleakproof AS leakproof, p.procost AS cost,
                p.proconfig IS NOT NULL AS has_config, p.prosrc AS body
         FROM pg_proc p
         JOIN pg_namespace n ON p.pronamespace = n.oid
         JOIN pg_language l ON p.prolang = l.oid
         WHERE (n.nspname, p.proname) IN (${names.map(([schema, name]) => `('${schema}', '${name}')`).join(", ")})`
    );
    const live = new Map<string, string>();
    for (const row of rows) {
        // Only the no-argument overload is the one these statements replace.
        if (String(row.args ?? "") !== "") continue;
        live.set(`${row.schema}.${row.name}`, describeFunction({
            returns: String(row.returns),
            language: String(row.language),
            volatility: String(row.volatility),
            strict: row.strict === true,
            parallel: String(row.parallel),
            securityDefiner: row.security_definer === true,
            leakproof: row.leakproof === true,
            cost: Number(row.cost),
            hasConfig: row.has_config === true,
            body: String(row.body)
        }));
    }
    // The schema exists whenever a function in it does.
    for (const [key, definition] of expected) {
        if (live.get(key) !== definition) return false;
    }
    return true;
}

/** The same statements as one script, for migration files and raw clients. */
export const RLS_BOOTSTRAP_SQL =
    "-- Rebase schema + RLS helper functions (required by the policies below)\n" +
    RLS_BOOTSTRAP_STATEMENTS.map(s => `${s};`).join("\n\n") + "\n";

/** One of the helpers the pre-1.0 `auth` schema held. */
interface LegacyAuthHelper {
    name: string;
    returns: string;
    /** The GUCs its body read. Any one of them identifies it. */
    reads: readonly string[];
}

/**
 * The three functions every pre-1.0 release put in `auth`. (The auth tables
 * lived in `rebase`, or wherever the users collection was declared.)
 *
 * `uid()` is matched on either spelling of the principal because Rebase wrote
 * both. Until v0.10.0 its body was
 * `SELECT NULLIF(current_setting('app.user_id', true), '')`; v0.10.0 renamed
 * the GUC to `app.uid` and kept `app.user_id` as a fallback; v0.14.0 moved the
 * helpers to `rebase`. A database last booted before v0.10.0 therefore holds an
 * `auth.uid()` that reads `app.user_id` alone — as does anything that copied
 * that body, the Rebase control plane included — and matching `app.uid` only
 * left every one of them in place, with the schema around it.
 *
 * This is the one place either spelling is listed: the drop and the report of
 * what it left are both generated from it, so they cannot disagree about which
 * functions are Rebase's.
 */
const LEGACY_AUTH_HELPERS: readonly LegacyAuthHelper[] = [
    { name: "uid", returns: "text", reads: ["app.uid", "app.user_id"] },
    { name: "jwt", returns: "jsonb", reads: ["app.jwt"] },
    { name: "roles", returns: "text", reads: ["app.user_roles"] }
];

/**
 * `pg_proc p` has a Rebase helper's name, arity and result type: what
 * `CREATE OR REPLACE` would have left, whatever the body.
 *
 * Two things that share that shape are excluded outright: a body reading
 * `request.jwt` (Supabase's helpers and anything modelled on them) and a
 * function an extension installed (`pg_session_jwt` puts an `auth.jwt()
 * RETURNS jsonb` in the same schema).
 */
const isLegacyHelperShaped = (helper: LegacyAuthHelper): string => `(
          p.proname = '${helper.name}' AND p.pronargs = 0
          AND pg_get_function_result(p.oid) = '${helper.returns}'
          AND strpos(p.prosrc, 'request.jwt') = 0
          AND NOT EXISTS (
              SELECT 1 FROM pg_depend e
              WHERE e.classid = 'pg_proc'::regclass AND e.objid = p.oid AND e.deptype = 'e'
          ))`;

/** `pg_proc p` is a helper Rebase wrote: its shape, and a body reading one of its GUCs. */
const isLegacyHelper = (helper: LegacyAuthHelper): string =>
    `${isLegacyHelperShaped(helper)}
          AND (${helper.reads.map(guc => `strpos(p.prosrc, '${guc}') > 0`).join(" OR ")})`;

/**
 * Removes the pre-1.0 `auth` schema, but only when Rebase is what put it there.
 *
 * ## Why this is safe against a Supabase database
 *
 * Two independent guards, and both have to pass:
 *
 *  1. **Each function is identified before it is dropped.** Ours returns `text`
 *     and reads the `app.uid` or `app.user_id` GUC; Supabase's returns `uuid`
 *     and reads `request.jwt.claims`. Nothing is dropped on a signature we did
 *     not write, so a Supabase database — where our `CREATE OR REPLACE` could
 *     never have succeeded in the first place, Postgres refusing to change a
 *     return type — matches nothing and this is a no-op. See
 *     {@link LEGACY_AUTH_HELPERS} for exactly what is matched.
 *  2. **`DROP SCHEMA … RESTRICT`**, never CASCADE. If anything else at all still
 *     lives in `auth` (Supabase's `users` table, its other helpers), the drop
 *     fails and the schema stays. CASCADE here would be unrecoverable.
 *
 * ## Why it cannot run too early
 *
 * Postgres records a dependency from every RLS policy to the functions its body
 * calls, so `DROP FUNCTION auth.uid()` fails for as long as a single policy
 * still references it. That is the interlock, and it is load-bearing: the drop
 * can only succeed once every policy has been recompiled to \`rebase.uid()\`.
 * Callers therefore run this *after* applying policies, and treat a failure as
 * "not yet — try again next boot" rather than as an error.
 */
export const DROP_LEGACY_AUTH_SCHEMA_SQL = `
DO $rebase_drop_legacy$
DECLARE
    dropped_any boolean := false;
BEGIN
    -- Each function is matched on its own result type and body, so a schema
    -- that merely shares the name keeps everything it has.
${LEGACY_AUTH_HELPERS.map(helper => `    IF EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = '${LEGACY_RLS_SCHEMA}' AND ${isLegacyHelper(helper)}
    ) THEN
        DROP FUNCTION ${LEGACY_RLS_SCHEMA}.${helper.name}();
        dropped_any := true;
    END IF;`).join("\n\n")}

    -- RESTRICT: only an empty schema goes. Anything else in there — including a
    -- Supabase installation left untouched above — keeps it. Swallowed so the
    -- helpers dropped above stay dropped; dropLegacyAuthSchema looks afterwards
    -- and says what is left.
    IF dropped_any THEN
        BEGIN
            EXECUTE 'DROP SCHEMA ${LEGACY_RLS_SCHEMA} RESTRICT';
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END IF;
END
$rebase_drop_legacy$;
`;

/** One object in the `auth` schema that `DROP SCHEMA … RESTRICT` refuses on. */
export interface LegacyAuthSchemaObject {
    /**
     * As Postgres names it: `function auth.uid()`, `table auth.sessions`.
     * `null` on the one row an empty schema answers with.
     */
    object: string | null;
    /**
     * `ours` is a helper Rebase wrote, which the drop removes. `lookalike` has a
     * helper's name and result type but a body no release wrote, so the drop
     * leaves it alone. `null` for everything else.
     */
    helper: "ours" | "lookalike" | null;
}

/**
 * What the `auth` schema holds, one row per object keeping it alive.
 *
 * No rows: the schema does not exist. A single row with a `null` object: it
 * exists and is empty. Read from the namespace entries in `pg_depend`, which
 * are what `DROP SCHEMA … RESTRICT` itself consults — minus whatever goes with
 * its owner (a serial's sequence, an identity column's), which Postgres does not
 * name either.
 */
export const LEGACY_AUTH_SCHEMA_CONTENTS_SQL = `
    SELECT pg_describe_object(d.classid, d.objid, d.objsubid) AS object,
           CASE
               WHEN d.classid <> 'pg_proc'::regclass THEN NULL
               WHEN EXISTS (
                   SELECT 1 FROM pg_proc p
                   WHERE p.oid = d.objid
                     AND (${LEGACY_AUTH_HELPERS.map(helper => `(${isLegacyHelper(helper)})`).join(" OR ")})
               ) THEN 'ours'
               WHEN EXISTS (
                   SELECT 1 FROM pg_proc p
                   WHERE p.oid = d.objid
                     AND (${LEGACY_AUTH_HELPERS.map(isLegacyHelperShaped).join(" OR ")})
               ) THEN 'lookalike'
           END AS helper
    FROM pg_namespace n
    LEFT JOIN pg_depend d
           ON d.refclassid = 'pg_namespace'::regclass AND d.refobjid = n.oid AND d.deptype = 'n'
          AND NOT EXISTS (
              SELECT 1 FROM pg_depend o
              WHERE o.classid = d.classid AND o.objid = d.objid AND o.deptype IN ('a', 'i')
          )
    WHERE n.nspname = '${LEGACY_RLS_SCHEMA}'
    ORDER BY helper NULLS LAST, object
`;

/** Somebody's policy that still calls a pre-1.0 helper. */
export interface LegacyRlsDependent {
    schema: string;
    table: string;
    policy: string;
}

/**
 * Policies whose body still calls `auth.uid()` / `auth.roles()` / `auth.jwt()`.
 *
 * Postgres will not drop a function a policy depends on, so this is exactly the
 * set standing between a database and losing the legacy schema. Rebase's own
 * policies leave the list on the next push or boot, when they are recompiled —
 * anything still here afterwards is hand-written, will never be recompiled by
 * anybody, and is the reason the drop keeps being skipped. Silence there would
 * leave an operator staring at a schema the release notes said would go.
 */
export const LEGACY_RLS_DEPENDENTS_SQL = `
    SELECT n.nspname AS schema, c.relname AS "table", p.polname AS policy
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pg_get_expr(p.polqual, p.polrelid) ~* '\\m${LEGACY_RLS_SCHEMA}\\.(uid|jwt|roles)\\s*\\('
       OR pg_get_expr(p.polwithcheck, p.polrelid) ~* '\\m${LEGACY_RLS_SCHEMA}\\.(uid|jwt|roles)\\s*\\('
    ORDER BY 1, 2, 3
`;

/** Somebody's *function* that still calls a pre-1.0 helper from its own body. */
export interface LegacyRlsFunctionDependent {
    schema: string;
    function: string;
}

/**
 * Functions whose body calls `auth.uid()` / `auth.roles()` / `auth.jwt()`.
 *
 * This is the half `DROP FUNCTION ... RESTRICT` cannot see, and the reason it
 * needs its own query. Postgres records a dependency for a *policy* that calls a
 * function, which is why the drop is safe against the policies above — but a
 * `LANGUAGE sql` function whose body is a **string literal** is not parsed when
 * it is created, so nothing is recorded and `RESTRICT` has nothing to refuse on.
 * The drop succeeds and the caller is left pointing at a function that no longer
 * exists, which fails at *query* time rather than at boot.
 *
 * A downstream project building on these helpers is not hypothetical: the Rebase
 * control plane defined `auth.is_org_member(uuid)` and `auth.is_org_admin(uuid)`
 * in this very schema, each calling `auth.uid()` in a string body, and eleven of
 * its row-level-security policies went through them. Every one of those would
 * have started failing the first time a recompile left no policy referencing
 * `auth.uid()` directly — the drop's own precondition. (Its migration 0065 has
 * since moved both to `public`, calling `rebase.uid()`.)
 *
 * Matching on the body text is the only option available, and it is deliberately
 * broad: a false positive costs a schema that stays one release longer and says
 * why, while a false negative costs somebody their policies.
 */
export const LEGACY_RLS_FUNCTION_DEPENDENTS_SQL = `
    SELECT n.nspname AS schema, p.proname AS function
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND NOT (n.nspname = '${LEGACY_RLS_SCHEMA}' AND p.proname IN ('uid', 'jwt', 'roles'))
      AND p.prosrc ~* '\\m${LEGACY_RLS_SCHEMA}\\.(uid|jwt|roles)\\s*\\('
    ORDER BY 1, 2
`;

/**
 * Retire the pre-1.0 `auth` schema, reporting what is holding it back.
 *
 * The shared implementation behind the CLI's post-push step and the runtime's
 * post-policy step. Both used to just fire {@link DROP_LEGACY_AUTH_SCHEMA_SQL}
 * and swallow whatever came back, which is right for the ordinary case — a
 * table not recompiled *yet* — and wrong for the one that never resolves: a
 * hand-written policy nothing will ever rewrite. Then the schema stays forever
 * and nothing ever says why.
 *
 * The drop itself had the same blind spot. A helper it did not recognise as
 * Rebase's stayed, and so did anything else in the schema, behind a
 * `DROP SCHEMA … RESTRICT` whose failure is swallowed so the helpers it did
 * drop stay dropped. The control plane's `auth.uid()` was one such: it read
 * `app.user_id` alone, the drop looked for `app.uid`, and the schema stayed
 * with no word said. So the schema is read twice. Before, so that one with no
 * Rebase helper in it is left alone: one already gone, as on every boot after
 * the drop, or one that was never Rebase's, like Supabase's — whose own
 * policies the checks below would otherwise report as blockers. After, to name
 * whatever is still there.
 */
export async function dropLegacyAuthSchema(
    run: (sql: string) => Promise<Record<string, unknown>[]>,
    report: { info: (m: string) => void; warn: (m: string) => void }
): Promise<void> {
    let before: LegacyAuthSchemaObject[];
    try {
        before = sqlRows<LegacyAuthSchemaObject>(await run(LEGACY_AUTH_SCHEMA_CONTENTS_SQL));
    } catch {
        return; // No catalogue access; nothing here is worth failing a boot for.
    }
    if (!before.some(o => o.helper !== null)) return;
    // Only a lookalike: nothing will be dropped, so whatever calls it is no
    // blocker, and saying so would ask somebody to rewrite their own policies.
    if (!before.some(o => o.helper === "ours")) {
        report.warn(describeLegacyAuthLeftovers(before, undefined));
        return;
    }

    let blockers: LegacyRlsDependent[];
    try {
        blockers = sqlRows<LegacyRlsDependent>(await run(LEGACY_RLS_DEPENDENTS_SQL));
    } catch {
        return; // No catalogue access; nothing here is worth failing a boot for.
    }

    if (blockers.length > 0) {
        report.warn(
            `The pre-1.0 \`${LEGACY_RLS_SCHEMA}\` schema cannot be removed yet: ${blockers.length} ` +
            `${blockers.length === 1 ? "policy still calls" : "policies still call"} ` +
            `\`${LEGACY_RLS_SCHEMA}.uid()\` and friends, and Postgres will not drop a function a policy ` +
            `depends on. Rebase's own policies are ` +
            `rewritten automatically — anything listed here is hand-written SQL that has to be updated to ` +
            `\`${REBASE_SCHEMA}.uid()\` by hand, after which the schema goes on its own:\n` +
            blockers.map(b => `  • ${b.schema}.${b.table} → "${b.policy}"`).join("\n")
        );
        return;
    }

    // The half Postgres will not refuse on. See LEGACY_RLS_FUNCTION_DEPENDENTS_SQL:
    // a string-literal SQL body records no dependency, so `DROP FUNCTION` drops
    // out from under a caller that is still using it and nothing complains until
    // a query runs.
    let borrowers: LegacyRlsFunctionDependent[];
    try {
        borrowers = sqlRows<LegacyRlsFunctionDependent>(await run(LEGACY_RLS_FUNCTION_DEPENDENTS_SQL));
    } catch {
        return;
    }

    if (borrowers.length > 0) {
        report.warn(
            `The pre-1.0 \`${LEGACY_RLS_SCHEMA}\` schema cannot be removed yet: ${borrowers.length} ` +
            `${borrowers.length === 1 ? "function calls" : "functions call"} ` +
            `\`${LEGACY_RLS_SCHEMA}.uid()\` and friends from its own body. Postgres records no dependency ` +
            `for that — a SQL body written as a string literal is never parsed — so dropping the helpers ` +
            `would leave these pointing at nothing, and they would fail when a query reached them rather ` +
            `than now. Repoint them at \`${REBASE_SCHEMA}.uid()\`, after which the schema goes on its own:\n` +
            borrowers.map(b => `  • ${b.schema}.${b.function}()`).join("\n")
        );
        return;
    }

    // A failure is not fatal — the schema is inert now that no policy calls it —
    // but it is reported below with whatever it left, not on its own.
    let failure: string | undefined;
    try {
        await run(DROP_LEGACY_AUTH_SCHEMA_SQL);
    } catch (err) {
        // Postgres names the dependent object in DETAIL, not in the message.
        const detail = err instanceof Error && "detail" in err && typeof err.detail === "string" ? err.detail : "";
        failure = (err instanceof Error ? err.message : String(err)) +
            (detail ? ` (${detail.replace(/\n/g, "; ")})` : "");
    }

    let left: LegacyAuthSchemaObject[];
    try {
        left = sqlRows<LegacyAuthSchemaObject>(await run(LEGACY_AUTH_SCHEMA_CONTENTS_SQL));
    } catch {
        if (failure) report.info(`Left the \`${LEGACY_RLS_SCHEMA}\` schema in place: ${failure}`);
        return;
    }
    if (left.length === 0) return; // Gone.

    report.warn(describeLegacyAuthLeftovers(left, failure));
}

/** At most this many objects are named; a schema this full is plainly in use. */
const MAX_LEFTOVERS_NAMED = 20;

/**
 * The warning for an `auth` schema the drop left standing.
 *
 * Said once for objects that are not Rebase's: on the next boot the schema holds
 * no helper, so {@link dropLegacyAuthSchema} leaves it alone — it is somebody
 * else's schema by then. A helper that is still there, Rebase's or a lookalike,
 * keeps it said on every boot until it goes.
 */
function describeLegacyAuthLeftovers(left: LegacyAuthSchemaObject[], failure: string | undefined): string {
    const schema = LEGACY_RLS_SCHEMA;
    const objects = left.filter(o => o.object !== null);

    if (objects.length === 0) {
        return `The pre-1.0 \`${schema}\` schema is empty, but this connection could not drop it — most likely ` +
            `because it does not own the schema. Run \`DROP SCHEMA ${schema};\` as its owner.`;
    }

    const why = failure
        ? `dropping Rebase's old helpers from it failed: ${failure}.`
        : `\`DROP SCHEMA … RESTRICT\` refuses a schema that is not empty, and Rebase drops only the helpers it ` +
          `can tell are its own.`;

    const lines = objects.slice(0, MAX_LEFTOVERS_NAMED).map(o =>
        o.helper === "ours"
            ? `  • ${o.object} — Rebase's old helper, which could not be dropped`
            : o.helper === "lookalike"
                ? `  • ${o.object} — named and typed like Rebase's old helper, but no release wrote this body, ` +
                  `so it was left alone; drop it by hand if nothing of yours calls it`
                : `  • ${o.object}`
    );
    if (objects.length > MAX_LEFTOVERS_NAMED) lines.push(`  • …and ${objects.length - MAX_LEFTOVERS_NAMED} more`);

    return `The pre-1.0 \`${schema}\` schema is still here: ${why} Still in it:\n` +
        lines.join("\n") + "\n" +
        `Anything of yours can stay where it is — Rebase no longer uses this schema — or move out with ` +
        `\`ALTER … SET SCHEMA\`. Once the schema is empty, \`DROP SCHEMA ${schema};\` removes it.`;
}
