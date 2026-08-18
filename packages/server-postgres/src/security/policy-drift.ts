/**
 * Compare the RLS policies a database actually has against the ones the
 * collections describe.
 *
 * Policies live in Postgres; the collection config is only their *source*.
 * Nothing reconciled the two, which is how the demo database served empty
 * collections indefinitely: its policies granted `TO authenticated` (a Supabase
 * role name) while requests run as `rebase_user`, so RLS filtered every row.
 * The config was later corrected and the database never noticed — an empty
 * table is indistinguishable from a table with no data.
 *
 * Expected policies are parsed from `generatePostgresPoliciesDdl`, the same
 * function `db push` uses to write `drizzle/policies.sql`, so this compares
 * against exactly what would be applied rather than a reimplementation.
 */
import { RLS_UID_SQL, type CollectionConfig } from "@rebasepro/types";

import { generatePostgresPoliciesDdl } from "../schema/generate-postgres-ddl-logic";

export interface PolicyRef {
    schema: string;
    table: string;
    name: string;
    /** Roles in the TO clause. */
    roles: string[];
    /** SELECT / INSERT / UPDATE / DELETE / ALL. */
    command: string;
    /** Whether a USING clause is present at all (not what it says). */
    hasUsing: boolean;
    /** Whether a WITH CHECK clause is present at all (not what it says). */
    hasWithCheck: boolean;
    /**
     * PERMISSIVE or RESTRICTIVE — the `AS` clause.
     *
     * An exact catalogue value on both sides, so it belongs with roles and
     * command rather than with the expression text. It matters more than either:
     * permissive policies are ORed together and restrictive ones ANDed, so a rule
     * declared `mode: "restrictive"` whose live policy is PERMISSIVE has had its
     * gate turned from a requirement into an alternative — the maximally
     * permissive way for this to be wrong.
     *
     * The DDL regex captured this from the start and the destructuring threw it
     * away; `pg_policies.permissive` was never selected.
     */
    mode?: "PERMISSIVE" | "RESTRICTIVE";
    /**
     * The live clause text, when read from `pg_policies`. Present only for live
     * policies (the expected side is parsed from DDL and does not carry it).
     * Used solely for the insecure-tautology scan, not for divergence — Postgres
     * rewrites this text, so it is not safe to diff against expected.
     */
    qual?: string | null;
    withCheck?: string | null;
}

export interface PolicyDrift {
    /** Described by the collections, absent from the database. */
    missing: PolicyRef[];
    /** In the database, described by no collection — stale pushes live here. */
    orphaned: PolicyRef[];
    /** Same policy name, different roles or command. */
    diverged: { expected: PolicyRef; actual: PolicyRef; differences: string[] }[];
    /**
     * A live policy whose expression is the known-permissive tautology
     * `rebase.uid() IS NOT NULL` — true for anonymous visitors too, because the
     * user path coerces a blank id to the `'anonymous'` sentinel. This is what
     * `policy.authenticated()` used to compile to, so a database pushed before
     * that fix carries it, and neither the name, roles, command nor clause
     * *presence* differs from the corrected policy — the only thing that changed
     * is the expression text, which this checker otherwise (correctly) ignores.
     * So it is the one drift that hides from every other check here.
     *
     * @see reason  a sentence naming the clause and what to do.
     */
    insecure: { policy: PolicyRef; reason: string }[];
    /**
     * A table the collections describe whose RLS switch is off.
     *
     * `ALTER TABLE posts DISABLE ROW LEVEL SECURITY` leaves every row in
     * `pg_policies` untouched, so before this category every expected policy
     * still matched on name, roles, command and clause presence and the checker
     * reported clean — on a table Postgres was applying no filter to at all.
     * Requests run as `rebase_user`, which holds full DML, so the table is wide
     * open while `doctor` certifies it.
     *
     * `forced` reports `relforcerowsecurity`, which is what also subjects the
     * table's *owner* to its policies. Its absence is not drift on its own —
     * Rebase does not connect as the owner in the request path — so it is
     * reported for context rather than raised as a failure.
     */
    rlsDisabled: { schema: string; table: string; forced: boolean }[];
}

export interface Queryable {
    query<R>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
}

// The trailing group captures whichever clause follows the TO list, which is
// what tells us the clause is present.
const CREATE_POLICY = /CREATE POLICY "([^"]+)" ON "([^"]+)"\."([^"]+)"\s+AS (\w+)\s+FOR (\w+)\s+TO ([^\n]+?)(\s+USING\s*\(|\s+WITH CHECK\s*\(|;)/gi;

const WITH_CHECK_NEXT = /^\s+WITH CHECK\s*\(/i;

/**
 * Index just past the `)` closing a clause whose `(` ends at `open`.
 *
 * Needed because a policy expression nests parens and can contain a quoted
 * literal holding either character, so "find the next `)`" would stop early and
 * miss the `WITH CHECK` that follows.
 */
function clauseEnd(ddl: string, open: number): number {
    let depth = 1;
    let inQuote = false;
    for (let i = open; i < ddl.length; i++) {
        const c = ddl[i];
        if (inQuote) {
            // '' is an escaped quote inside a string, not a close.
            if (c === "'") {
                if (ddl[i + 1] === "'") i++;
                else inQuote = false;
            }
            continue;
        }
        if (c === "'") inQuote = true;
        else if (c === "(") depth++;
        else if (c === ")" && --depth === 0) return i + 1;
    }
    return ddl.length;
}

/**
 * `AS PERMISSIVE` / `AS RESTRICTIVE` from either side, or undefined.
 *
 * The DDL spells it as a bare word; `pg_policies.permissive` is the string
 * `"PERMISSIVE"`/`"RESTRICTIVE"` on modern Postgres but a boolean on some
 * drivers and older servers, so both are accepted. Anything unrecognised
 * becomes `undefined` and the comparison below skips it rather than inventing
 * drift from a shape we did not anticipate.
 */
function normalizeMode(raw: unknown): "PERMISSIVE" | "RESTRICTIVE" | undefined {
    if (typeof raw === "boolean") return raw ? "PERMISSIVE" : "RESTRICTIVE";
    if (typeof raw !== "string") return undefined;
    const upper = raw.trim().toUpperCase();
    if (upper === "PERMISSIVE" || upper === "TRUE" || upper === "T") return "PERMISSIVE";
    if (upper === "RESTRICTIVE" || upper === "FALSE" || upper === "F") return "RESTRICTIVE";
    return undefined;
}

/** Parse the generated DDL rather than rebuilding the shape by hand. */
export function parseExpectedPolicies(ddl: string): PolicyRef[] {
    const found: PolicyRef[] = [];
    for (const m of ddl.matchAll(CREATE_POLICY)) {
        const [, name, schema, table, modeRaw, command, rolesRaw, clause] = m;
        const roles = rolesRaw
            .split(",")
            .map((r) => r.trim().replace(/^"|"$/g, ""))
            .filter(Boolean);

        // The generator emits USING before WITH CHECK, so what follows the TO
        // list settles USING; WITH CHECK is then whatever follows that clause.
        const hasUsing = /USING/i.test(clause);
        const hasWithCheck = hasUsing
            ? WITH_CHECK_NEXT.test(ddl.slice(clauseEnd(ddl, m.index + m[0].length)))
            : /WITH CHECK/i.test(clause);

        found.push({
            schema, table, name, roles,
            command: command.toUpperCase(),
            hasUsing, hasWithCheck,
            mode: normalizeMode(modeRaw)
        });
    }
    return found;
}

async function readLivePolicies(client: Queryable, schemas: string[]): Promise<PolicyRef[]> {
    const { rows } = await client.query<{
        schemaname: string; tablename: string; policyname: string; roles: string[] | string; cmd: string;
        qual: string | null; with_check: string | null; permissive: string | boolean | null;
    }>(
        `SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check, permissive
         FROM pg_policies
         WHERE schemaname = ANY($1)`,
        [schemas]
    );

    return rows.map((r) => ({
        schema: r.schemaname,
        table: r.tablename,
        name: r.policyname,
        // node-postgres yields text[] as an array; some drivers hand back "{a,b}".
        roles: Array.isArray(r.roles)
            ? r.roles
            : String(r.roles ?? "").replace(/^\{|\}$/g, "").split(",").filter(Boolean),
        command: (r.cmd ?? "ALL").toUpperCase(),
        // Presence only. Postgres rewrites the text, but it does not invent or
        // drop a clause: NULL here means the policy genuinely has none.
        hasUsing: r.qual != null,
        hasWithCheck: r.with_check != null,
        mode: normalizeMode(r.permissive),
        qual: r.qual,
        withCheck: r.with_check
    }));
}

/**
 * Tables the collections describe whose RLS switch is off.
 *
 * Read from `pg_class` because `pg_policies` cannot answer it: disabling RLS
 * leaves the policy rows in place, so every other comparison in this file keeps
 * matching while Postgres applies none of them.
 *
 * Only tables that expect at least one policy are considered. A table with no
 * declared rules is not asserting anything about RLS, and reporting it would
 * make the check noisy on exactly the projects least able to judge the noise.
 */
async function readTablesWithRlsOff(
    client: Queryable,
    tables: { schema: string; table: string }[]
): Promise<{ schema: string; table: string; forced: boolean }[]> {
    if (tables.length === 0) return [];
    const { rows } = await client.query<{
        schemaname: string; tablename: string; relrowsecurity: boolean; relforcerowsecurity: boolean;
    }>(
        `SELECT n.nspname AS schemaname,
                c.relname AS tablename,
                c.relrowsecurity,
                c.relforcerowsecurity
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'r'
            AND (n.nspname || '.' || c.relname) = ANY($1)`,
        [tables.map((t) => `${t.schema}.${t.table}`)]
    );

    return rows
        .filter((r) => !r.relrowsecurity)
        .map((r) => ({
            schema: r.schemaname,
            table: r.tablename,
            forced: !!r.relforcerowsecurity
        }));
}

/**
 * The permissive tautology `rebase.uid() IS NOT NULL`, without the
 * `<> 'anonymous'` guard that makes it mean "signed in".
 *
 * Whitespace varies with Postgres's rewrite, so match on a collapsed form. The
 * guard clause (`<> 'anonymous'`, in any spelling) is what distinguishes the
 * corrected policy from the stale one, so its presence clears the text.
 *
 * Both schema spellings are matched. The helpers moved from `auth` to `rebase`
 * in 1.0, and this check reads policies *as the database stored them*: a
 * database pushed before the move still holds `auth.uid()` until it is
 * recompiled, while everything written since — including raw `securityRules`
 * SQL, which the compiler rewrites on the way in — stores `rebase.uid()`.
 * Matching only the pre-1.0 name made the check blind to every policy a current
 * release could write, which is precisely the set still worth scanning.
 */
function isPermissiveAuthTautology(clause: string | null | undefined): boolean {
    if (!clause) return false;
    const flat = clause.toLowerCase().replace(/\s+/g, " ");
    if (!/\b(?:rebase|auth)\.uid\s*\(\s*\)\s*is not null/.test(flat)) return false;
    // The fix appends `AND rebase.uid() <> 'anonymous'`; Postgres may store the
    // literal as `'anonymous'::text`. Either spelling means it is the corrected
    // policy, not the tautology.
    return !/<>\s*'anonymous'/.test(flat) && !/!=\s*'anonymous'/.test(flat);
}

const keyOf = (p: PolicyRef) => `${p.schema}.${p.table}.${p.name}`;
const sameRoles = (a: string[], b: string[]) =>
    a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");

/**
 * Diff expected against live.
 *
 * Compares names, roles, command, and whether each clause exists — all exact
 * values. Policy expression *text* is deliberately not compared: Postgres
 * rewrites `qual`/`with_check` when storing them (parenthesising, casting,
 * schema-qualifying), so text comparison reports drift that does not exist, and
 * a check that cries wolf gets ignored.
 *
 * Presence is not text, though. A NULL `qual` is not a rewrite of an
 * expression, it is the absence of one, and absence has no false-positive risk:
 * either the generator emitted a clause or it did not. That distinction is worth
 * the extra comparison — a production database was found with a SELECT policy
 * whose `qual` was NULL, matching on every field this checked and denying 100%
 * of reads. The same blindness would hide a policy that fails open.
 */
export async function checkPolicyDrift(
    client: Queryable,
    collections: CollectionConfig[]
): Promise<PolicyDrift> {
    const expected = parseExpectedPolicies(generatePostgresPoliciesDdl(collections));
    const schemas = [...new Set(expected.map((p) => p.schema))];
    // Nothing expected means nothing to reconcile against; scanning every
    // schema would report the whole database as orphaned.
    if (schemas.length === 0) return { missing: [], orphaned: [], diverged: [], insecure: [], rlsDisabled: [] };

    const live = await readLivePolicies(client, schemas);
    const liveByKey = new Map(live.map((p) => [keyOf(p), p]));
    const expectedByKey = new Map(expected.map((p) => [keyOf(p), p]));

    const drift: PolicyDrift = { missing: [], orphaned: [], diverged: [], insecure: [], rlsDisabled: [] };

    // Before comparing policy against policy: is the switch even on? A table
    // with RLS disabled matches every expected policy on every field compared
    // below, so this has to be asked separately or it cannot be asked at all.
    const expectedTables = [...new Map(
        expected.map((p) => [`${p.schema}.${p.table}`, { schema: p.schema, table: p.table }])
    ).values()];
    drift.rlsDisabled = await readTablesWithRlsOff(client, expectedTables);

    // Scan every live policy for the permissive tautology. This is deliberately
    // independent of the name-keyed diff below: a database pushed before the
    // `authenticated()` fix matches its expected policy on name, roles, command
    // and clause presence, so nothing else here would flag it.
    for (const p of live) {
        const clause = isPermissiveAuthTautology(p.qual)
            ? "USING"
            : isPermissiveAuthTautology(p.withCheck) ? "WITH CHECK" : null;
        if (clause) {
            drift.insecure.push({
                policy: p,
                reason: `${clause} is \`${RLS_UID_SQL} IS NOT NULL\`, which is true for anonymous ` +
                    `visitors too — this grants access to signed-out requests. It predates the ` +
                    `\`policy.authenticated()\` fix; re-run \`rebase db push\` to tighten it.`
            });
        }
    }

    for (const [key, want] of expectedByKey) {
        const got = liveByKey.get(key);
        if (!got) {
            drift.missing.push(want);
            continue;
        }
        const differences: string[] = [];
        if (!sameRoles(want.roles, got.roles)) {
            differences.push(`roles: expected [${want.roles.join(", ")}], database has [${got.roles.join(", ")}]`);
        }
        if (want.command !== got.command) {
            differences.push(`command: expected ${want.command}, database has ${got.command}`);
        }
        // Skipped when either side is unknown: an unrecognised catalogue shape
        // should not manufacture drift. See `normalizeMode`.
        if (want.mode && got.mode && want.mode !== got.mode) {
            differences.push(
                `mode: expected ${want.mode}, database has ${got.mode}` +
                (got.mode === "PERMISSIVE"
                    ? " — a RESTRICTIVE rule is ANDed with the others, a PERMISSIVE one is ORed, so this policy now widens access instead of narrowing it"
                    : " — a PERMISSIVE rule is ORed with the others, a RESTRICTIVE one is ANDed, so this policy now narrows access instead of widening it")
            );
        }
        for (const clause of ["USING", "WITH CHECK"] as const) {
            const key = clause === "USING" ? "hasUsing" : "hasWithCheck";
            if (want[key] === got[key]) continue;
            differences.push(want[key]
                ? `${clause}: expected an expression, database has none — this policy matches no rows`
                : `${clause}: expected none, database has an expression`);
        }
        if (differences.length > 0) drift.diverged.push({ expected: want, actual: got, differences });
    }

    for (const [key, got] of liveByKey) {
        if (!expectedByKey.has(key)) drift.orphaned.push(got);
    }

    return drift;
}

/**
 * Does this name look like one the generator produced for this table?
 *
 * Unnamed rules compile to `<table>_<op>_<sha1[0:7]>` (plus `_<idx>` when one
 * rule spans several operations), and the hash covers the rule's semantics — so
 * *editing* a rule renames its policy. The policy under the old name is left
 * behind by `db push`, which only DROPs the names it is about to CREATE, and
 * Postgres ORs PERMISSIVE policies together: a superseded `USING (true)` keeps
 * granting everything no matter how tight its replacement is.
 *
 * Matching the shape is what makes dropping them safe. A hand-written policy
 * would have to collide with a 7-hex digest to be mistaken for generated one;
 * a policy named anything else is left alone and merely reported, because a
 * custom name is indistinguishable from one someone wrote in SQL on purpose.
 */
export function isGeneratedPolicyName(name: string, table: string): boolean {
    return new RegExp(`^${table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_(select|insert|update|delete|all)_[0-9a-f]{7}(_\\d+)?$`)
        .test(name);
}

export interface OrphanCleanup {
    /** Superseded generated policies that were dropped. */
    dropped: PolicyRef[];
    /** Orphans left in place because their names are not generator-shaped. */
    kept: PolicyRef[];
}

/**
 * Drop the policies an earlier push superseded but never removed.
 *
 * Only touches tables the collections describe — a table with no expected
 * policy is not ours to reconcile, and scanning by schema alone would sweep up
 * policies belonging to something else sharing the database.
 */
export async function dropOrphanedPolicies(
    client: Queryable,
    drift: PolicyDrift,
    collections: CollectionConfig[]
): Promise<OrphanCleanup> {
    const expected = parseExpectedPolicies(generatePostgresPoliciesDdl(collections));
    const managed = new Set(expected.map((p) => `${p.schema}.${p.table}`));

    const cleanup: OrphanCleanup = { dropped: [], kept: [] };
    for (const p of drift.orphaned) {
        if (!managed.has(`${p.schema}.${p.table}`) || !isGeneratedPolicyName(p.name, p.table)) {
            cleanup.kept.push(p);
            continue;
        }
        // Identifiers are quoted, and the name came from pg_policies rather than
        // from user input, so it is already a valid identifier.
        await client.query(`DROP POLICY IF EXISTS "${p.name}" ON "${p.schema}"."${p.table}"`);
        cleanup.dropped.push(p);
    }
    return cleanup;
}

export const hasDrift = (d: PolicyDrift): boolean =>
    d.missing.length > 0 || d.orphaned.length > 0 || d.diverged.length > 0 || d.insecure.length > 0
    || d.rlsDisabled.length > 0;

/** Human-readable report; empty string when the database matches the config. */
export function formatPolicyDrift(drift: PolicyDrift): string {
    if (!hasDrift(drift)) return "";
    const lines: string[] = [];

    // First, because it subsumes every other finding on the same table: if RLS
    // is off, the policies listed below are not being applied at all.
    if (drift.rlsDisabled.length > 0) {
        lines.push("  RLS DISABLED — the table has policies, and Postgres is applying none of them:");
        for (const t of drift.rlsDisabled) {
            lines.push(`    • ${t.schema}.${t.table}${t.forced ? "" : " (and FORCE is off)"}`);
        }
        lines.push("    Every row is readable and writable by any request that reaches the table.");
        lines.push(`    Fix: ALTER TABLE "<schema>"."<table>" ENABLE ROW LEVEL SECURITY; or re-run \`rebase db push\`.`);
    }
    if (drift.missing.length > 0) {
        lines.push("  Missing — described by your collections, absent from the database:");
        for (const p of drift.missing) lines.push(`    • ${p.schema}.${p.table} → "${p.name}" (${p.command} TO ${p.roles.join(", ")})`);
        lines.push("    Run `rebase db push` to apply them.");
    }
    if (drift.orphaned.length > 0) {
        lines.push("  Orphaned — in the database, described by no collection:");
        for (const p of drift.orphaned) lines.push(`    • ${p.schema}.${p.table} → "${p.name}" (${p.command} TO ${p.roles.join(", ")})`);
        lines.push("    Left behind by an earlier push. These still filter rows.");
    }
    if (drift.diverged.length > 0) {
        lines.push("  Diverged — same policy, different definition:");
        for (const d of drift.diverged) {
            lines.push(`    • ${d.expected.schema}.${d.expected.table} → "${d.expected.name}"`);
            for (const diff of d.differences) lines.push(`        ${diff}`);
        }
    }
    if (drift.insecure.length > 0) {
        lines.push("  Insecure — a live policy grants access it should not:");
        for (const i of drift.insecure) {
            lines.push(`    • ${i.policy.schema}.${i.policy.table} → "${i.policy.name}"`);
            lines.push(`        ${i.reason}`);
        }
    }
    return lines.join("\n");
}
