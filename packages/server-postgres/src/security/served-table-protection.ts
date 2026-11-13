/**
 * Whether the database protects every declared table this driver is about to
 * serve — and the refusal to serve one it does not.
 *
 * A provisioning boot leaves each declared table with row-level security on
 * and its declared policies written (or, where Postgres refuses the `ENABLE`,
 * with the request role's privileges taken back). A backend that provisions
 * nothing — `REBASE_PROVISION=false`, `provisionSchema: false`,
 * `provision: { tables: false }`, `REBASE_MIGRATE_ON_BOOT=none` — trusts the
 * database to be in that state already, and the database may not be: a
 * hand-written migration, a `DISABLE ROW LEVEL SECURITY` left over from
 * debugging, a restore from a dump older than the policies. With RLS off,
 * every request role that holds the schema grant reads and writes every row,
 * whatever `rls` the table declares.
 *
 * So, wherever a declared table starts being served (boot, after the policies
 * step; a live schema apply's refresh, adoption included), the catalogue is
 * read — one statement, no DDL — and a table is withheld when:
 *
 * - its row-level security is **off** (`relrowsecurity`): every row would be
 *   served to every caller; or
 * - it declares policies and the database has **none of them** (by the name
 *   the provisioning path gives each — `planTablePolicies`, the same plan, so
 *   the same derived names): RLS on with no declared policy is either a table
 *   that answers nothing, or one whose access some policy this schema does
 *   not declare decides — a stray `USING (true)` would serve every row; or
 * - a **restrictive** policy it declares is missing, or is not restrictive in
 *   the database: a restrictive policy is a gate (a tenant, an `anon` deny),
 *   and the permissive grants without it reach rows it exists to keep out; or
 * - a many-to-many **junction** it reads and writes through (declared or
 *   implicit) fails any of the above, judged by the junction's own planned
 *   policies.
 *
 * A missing **permissive** policy only narrows access (Postgres ORs the
 * permissive policies), so the table is served and the boot log warns, naming
 * the policy. A policy the schema does not declare cannot be judged here — it
 * may be the database's own business — and is `rebase doctor`'s to report.
 *
 * Withheld is what introspection does with a table that has RLS off: not
 * served, the statements that protect it in the log. A request for it is
 * refused naming the reason (never the SQL); nothing else stops serving.
 *
 * @module
 */
import type { CompiledTable } from "@rebasepro/types";
import { logger } from "@rebasepro/server";
import { planTablePolicies, quoteSqlLiteral } from "../schema/generate-postgres-ddl-logic";
import type { PostgresTableRegistry } from "../model/PostgresTableRegistry";
import type { RawSqlRunner } from "./rls-enforcement";

/** A declared table the database does not protect, and how to protect it. */
export interface UnprotectedServedTable {
    /** The table's slug: what it is served under. */
    slug: string;
    /** `schema.table`. */
    qualified: string;
    /**
     * What is wrong: RLS off, RLS on with none of its declared policies, or a
     * declared restrictive policy missing (or permissive in the database).
     */
    problem: "rls-off" | "no-policies" | "restrictive-missing";
    /** The statements that bring the table to what a provisioning boot leaves. */
    remediationSql: string;
    /** The declared policies the database does not have as declared, by name. */
    missingPolicies: string[];
    /**
     * Set when the table is withheld for a many-to-many junction it writes
     * and reads through, not for itself: the junction's `schema.table`.
     * `qualified`, `problem`, `remediationSql` and `missingPolicies` are then
     * the junction's.
     */
    junction?: string;
}

/** A declared table served without some of its permissive policies: access is narrower than declared. */
export interface NarrowedServedTable {
    slug: string;
    qualified: string;
    /** The declared permissive policies the database does not have. */
    missingPolicies: string[];
    /** The statements that create them. */
    remediationSql: string;
}

/** What {@link findServedTableProtection} found: tables to withhold, and tables served narrower than declared. */
export interface ServedTableProtection {
    unprotected: UnprotectedServedTable[];
    narrowed: NarrowedServedTable[];
}

/** What {@link findUnprotectedServedTables} renders the policies with — the boot's admin switch. */
export interface ServedTableProtectionOptions {
    /** The driver's admin switch is live: admin policies go `TO rebase_admin`. */
    adminRoleAvailable?: boolean;
    /** The admin request role exists: admin-only policies get their companion. */
    adminRequestRoleAvailable?: boolean;
}

/**
 * The declared tables among `tables` that exist in the database unprotected.
 * One catalogue read; a table the database does not have is not this check's
 * (it answers "table not found" already). Views and junctions are left out:
 * a view has no row-level security of its own, and a junction is never served.
 */
export async function findUnprotectedServedTables(
    run: RawSqlRunner,
    tables: readonly CompiledTable[],
    options: ServedTableProtectionOptions = {}
): Promise<UnprotectedServedTable[]> {
    return (await findServedTableProtection(run, tables, options)).unprotected;
}

/**
 * {@link findUnprotectedServedTables}, with the tables served narrower than
 * declared (a permissive policy missing) beside them. One catalogue read.
 */
export async function findServedTableProtection(
    run: RawSqlRunner,
    tables: readonly CompiledTable[],
    options: ServedTableProtectionOptions = {}
): Promise<ServedTableProtection> {
    const served = tables.filter(table => table.descriptor.kind === "table");
    if (served.length === 0) return { unprotected: [], narrowed: [] };
    const planned = planTablePolicies(served, options);
    const plans = new Map(planned.map(plan => [plan.qualified, plan]));
    const wanted = served.map(({ descriptor }) => ({
        slug: descriptor.slug,
        schema: descriptor.schema,
        name: descriptor.table
    }));
    // The many-to-many junctions, declared or implicit, and the tables that
    // read and write through each (SEC-FIX-4 R-2). A junction no table
    // declares is in the plan too, with its derived policies, and held to the
    // same rule; one that fails withholds the tables whose relations use it.
    const owners = new Map<string, Set<string>>();
    for (const { descriptor } of served) {
        for (const relation of descriptor.relations) {
            if (relation.kind !== "manyToMany") continue;
            const named = planned.filter(plan => plan.table === relation.through.table);
            const junction = named.find(plan => plan.schema === descriptor.schema) ?? named[0];
            if (!junction) continue;
            const set = owners.get(junction.qualified) ?? new Set<string>();
            set.add(descriptor.slug);
            owners.set(junction.qualified, set);
        }
    }
    const declaredQualified = new Set(served.map(({ descriptor }) => `${descriptor.schema}.${descriptor.table}`));
    for (const qualified of owners.keys()) {
        if (declaredQualified.has(qualified)) continue;
        const plan = plans.get(qualified);
        if (plan) wanted.push({ slug: "", schema: plan.schema, name: plan.table });
    }
    const rows = await run(
        `SELECT w.slug, n.nspname AS schema, c.relname AS name, c.relrowsecurity AS rls,
                (SELECT coalesce(jsonb_agg(jsonb_build_object('name', p.polname::text, 'permissive', p.polpermissive)), '[]'::jsonb)
                   FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
           FROM jsonb_to_recordset(${quoteSqlLiteral(JSON.stringify(wanted))}::jsonb) AS w(slug text, schema text, name text)
           JOIN pg_namespace n ON n.nspname = w.schema
           JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = w.name AND c.relkind IN ('r', 'p')`
    );
    const unprotected: UnprotectedServedTable[] = [];
    const narrowed: NarrowedServedTable[] = [];
    for (const row of rows) {
        const qualified = `${String(row.schema)}.${String(row.name)}`;
        const plan = plans.get(qualified);
        const declared = plan?.policies ?? [];
        const existing = existingPolicies(row.policies);
        const rls = row.rls === true;
        const slug = String(row.slug);
        const enable = plan?.enableRls ?? `ALTER TABLE ${qualified} ENABLE ROW LEVEL SECURITY;`;
        if (!rls) {
            unprotected.push({
                slug,
                qualified,
                problem: "rls-off",
                remediationSql: [enable, ...(plan?.policyStatements ?? [])].join("\n"),
                missingPolicies: declared.map(policy => policy.name)
            });
            continue;
        }
        if (declared.length === 0) continue;
        const present = declared.filter(policy => existing.has(policy.name));
        const restrictiveMissing = declared.filter(policy => policy.restrictive && existing.get(policy.name) !== false);
        const permissiveMissing = declared.filter(policy => !policy.restrictive && !existing.has(policy.name));
        if (present.length === 0 || restrictiveMissing.length > 0) {
            const missing = present.length === 0 ? declared : restrictiveMissing;
            unprotected.push({
                slug,
                qualified,
                problem: present.length === 0 ? "no-policies" : "restrictive-missing",
                remediationSql: missing.flatMap(policy => policy.statements).join("\n"),
                missingPolicies: missing.map(policy => policy.name)
            });
            continue;
        }
        if (permissiveMissing.length > 0) {
            narrowed.push({
                slug,
                qualified,
                missingPolicies: permissiveMissing.map(policy => policy.name),
                remediationSql: permissiveMissing.flatMap(policy => policy.statements).join("\n")
            });
        }
    }
    return { unprotected: withJunctionOwners(unprotected, owners), narrowed: narrowed.filter(table => table.slug !== "") };
}

/**
 * The tables to withhold: each declared table found unprotected, and each
 * table whose many-to-many junction was — once, the table's own problem
 * first. An implicit junction has no slug of its own and is never served; it
 * is reached only through its owners' relations, so withholding the owners is
 * what keeps an unprotected junction from being read or written through the
 * API. The related tables stay served: their rows are behind their own policies.
 */
function withJunctionOwners(found: readonly UnprotectedServedTable[], owners: ReadonlyMap<string, ReadonlySet<string>>): UnprotectedServedTable[] {
    const out = found.filter(table => table.slug !== "");
    const named = new Set(out.map(table => table.slug));
    for (const junction of found) {
        for (const slug of owners.get(junction.qualified) ?? []) {
            if (named.has(slug)) continue;
            named.add(slug);
            out.push({ ...junction, slug, junction: junction.qualified });
        }
    }
    return out;
}

/** The policies the catalogue read found on a table: name → permissive. */
function existingPolicies(value: unknown): Map<string, boolean> {
    const out = new Map<string, boolean>();
    const list: unknown = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(list)) return out;
    for (const entry of list) {
        if (typeof entry !== "object" || entry === null || !("name" in entry) || typeof entry.name !== "string") continue;
        out.set(entry.name, !("permissive" in entry) || entry.permissive !== false);
    }
    return out;
}

/** What a caller asking for a withheld table is told: the reason, never the SQL. */
export function withheldTableMessage(table: Pick<UnprotectedServedTable, "slug" | "problem" | "junction">): string {
    if (table.junction !== undefined) {
        return `The table "${table.slug}" is not served: the junction table of one of its many-to-many relations is not ` +
            "protected by row-level security in the database. The server's boot log names the statements that protect it.";
    }
    if (table.problem === "rls-off") {
        return `The table "${table.slug}" is not served: row-level security is disabled on it in the database, so every ` +
            "caller would reach every row. The server's boot log names the statements that protect it.";
    }
    if (table.problem === "restrictive-missing") {
        return `The table "${table.slug}" is not served: a restrictive row-level security policy it declares is missing ` +
            "in the database, so its other policies would reach rows that policy keeps out. The server's boot log names the " +
            "statements that create it.";
    }
    return `The table "${table.slug}" is not served: it declares row-level security policies and the database has ` +
        "none of them on it. The server's boot log names the statements that create them.";
}

/**
 * Withhold every table `found` names from `registry`, and say so: one error
 * per table, with the statements that protect it, and what to run instead.
 */
export function withholdUnprotectedTables(
    registry: PostgresTableRegistry,
    found: readonly UnprotectedServedTable[]
): void {
    for (const table of found) {
        registry.withhold(table.slug, withheldTableMessage(table));
        const what = table.problem === "rls-off"
            ? "row-level security is DISABLED on it in the database, so every request role would read and write every row"
            : table.problem === "restrictive-missing"
                ? `the restrictive polic${table.missingPolicies.length > 1 ? "ies" : "y"} ${table.missingPolicies.map(name => `"${name}"`).join(", ")} ` +
                    "it declares " + (table.missingPolicies.length > 1 ? "are" : "is") + " missing in the database (or not restrictive there), " +
                    "so its other policies would reach rows that gate keeps out"
                : "it declares policies, and the database has none of them on it (a policy this schema does not declare decides " +
                    "who reads it, or nobody does)";
        const subject = table.junction !== undefined
            ? `its many-to-many junction ${table.junction}: ${what}`
            : what;
        logger.error(
            `🔒 [rls] Not serving "${table.slug}" (${table.junction !== undefined ? "through " : ""}${table.qualified}): ${subject}. This boot did not change that ` +
            "(it provisions nothing, or Postgres refused it). Run, as part of your change process (or `rebase db push`):\n" +
            table.remediationSql.split("\n").map(line => `      ${line}`).join("\n")
        );
    }
}

/**
 * Say, once per table, that it is served with some of its declared permissive
 * policies missing: those callers are refused rows the schema grants them. It
 * is served — a missing grant only narrows access — and the log names the
 * statements that create the policies.
 */
export function warnNarrowedTables(found: readonly NarrowedServedTable[]): void {
    for (const table of found) {
        logger.warn(
            `🔒 [rls] "${table.slug}" (${table.qualified}) is served without the polic${table.missingPolicies.length > 1 ? "ies" : "y"} ` +
            `${table.missingPolicies.map(name => `"${name}"`).join(", ")} it declares, so the callers ` +
            (table.missingPolicies.length > 1 ? "they grant" : "it grants") + " are refused rows. Run (or `rebase db push`):\n" +
            table.remediationSql.split("\n").map(line => `      ${line}`).join("\n")
        );
    }
}
