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

const CREATE_POLICY = /CREATE POLICY "([^"]+)" ON "([^"]+)"\."([^"]+)"\s+AS (\w+)\s+FOR (\w+)\s+TO ([^\n]+?)(?:\s+USING|\s+WITH CHECK|;)/gi;

/** Parse the generated DDL rather than rebuilding the shape by hand. */
export function parseExpectedPolicies(ddl: string): PolicyRef[] {
    const found: PolicyRef[] = [];
    for (const m of ddl.matchAll(CREATE_POLICY)) {
        const [, name, schema, table, , command, rolesRaw] = m;
        const roles = rolesRaw
            .split(",")
            .map((r) => r.trim().replace(/^"|"$/g, ""))
            .filter(Boolean);
        found.push({ schema, table, name, roles, command: command.toUpperCase() });
    }
    return found;
}

async function readLivePolicies(client: Queryable, schemas: string[]): Promise<PolicyRef[]> {
    const { rows } = await client.query<{
        schemaname: string; tablename: string; policyname: string; roles: string[] | string; cmd: string;
    }>(
        `SELECT schemaname, tablename, policyname, roles, cmd
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
        command: (r.cmd ?? "ALL").toUpperCase()
    }));
}

const keyOf = (p: PolicyRef) => `${p.schema}.${p.table}.${p.name}`;
const sameRoles = (a: string[], b: string[]) =>
    a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");

/**
 * Diff expected against live.
 *
 * Compares names, roles and command only — all exact values. Policy
 * *expressions* are deliberately not compared: Postgres rewrites `qual`/
 * `with_check` when storing them (parenthesising, casting, schema-qualifying),
 * so text comparison reports drift that does not exist, and a check that cries
 * wolf gets ignored. Roles alone catch the failure this exists for.
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
        if (differences.length > 0) drift.diverged.push({ expected: want, actual: got, differences });
    }

    for (const [key, got] of liveByKey) {
        if (!expectedByKey.has(key)) drift.orphaned.push(got);
    }

    return drift;
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
