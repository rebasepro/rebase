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
import type { CollectionConfig } from "@rebasepro/types";

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
}

export interface PolicyDrift {
    /** Described by the collections, absent from the database. */
    missing: PolicyRef[];
    /** In the database, described by no collection — stale pushes live here. */
    orphaned: PolicyRef[];
    /** Same policy name, different roles or command. */
    diverged: { expected: PolicyRef; actual: PolicyRef; differences: string[] }[];
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

/** Parse the generated DDL rather than rebuilding the shape by hand. */
export function parseExpectedPolicies(ddl: string): PolicyRef[] {
    const found: PolicyRef[] = [];
    for (const m of ddl.matchAll(CREATE_POLICY)) {
        const [, name, schema, table, , command, rolesRaw, clause] = m;
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

        found.push({ schema, table, name, roles, command: command.toUpperCase(), hasUsing, hasWithCheck });
    }
    return found;
}

async function readLivePolicies(client: Queryable, schemas: string[]): Promise<PolicyRef[]> {
    const { rows } = await client.query<{
        schemaname: string; tablename: string; policyname: string; roles: string[] | string; cmd: string;
        qual: string | null; with_check: string | null;
    }>(
        `SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
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
        hasWithCheck: r.with_check != null
    }));
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
    if (schemas.length === 0) return { missing: [], orphaned: [], diverged: [] };

    const live = await readLivePolicies(client, schemas);
    const liveByKey = new Map(live.map((p) => [keyOf(p), p]));
    const expectedByKey = new Map(expected.map((p) => [keyOf(p), p]));

    const drift: PolicyDrift = { missing: [], orphaned: [], diverged: [] };

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
    d.missing.length > 0 || d.orphaned.length > 0 || d.diverged.length > 0;

/** Human-readable report; empty string when the database matches the config. */
export function formatPolicyDrift(drift: PolicyDrift): string {
    if (!hasDrift(drift)) return "";
    const lines: string[] = [];

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
    return lines.join("\n");
}
