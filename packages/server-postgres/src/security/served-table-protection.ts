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
 * - it declares policies and the database has **none** on it: RLS on with no
 *   policy denies every row, so the table would answer every read with nothing
 *   and every write with a refusal, while its declaration says otherwise.
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
    /** What is wrong: RLS off, or RLS on with none of its declared policies. */
    problem: "rls-off" | "no-policies";
    /** The statements that bring the table to what a provisioning boot leaves. */
    remediationSql: string;
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
    const served = tables.filter(table => table.descriptor.kind === "table");
    if (served.length === 0) return [];
    const plans = new Map(planTablePolicies(served, options).map(plan => [plan.qualified, plan]));
    const wanted = served.map(({ descriptor }) => ({
        slug: descriptor.slug,
        schema: descriptor.schema,
        name: descriptor.table
    }));
    const rows = await run(
        `SELECT w.slug, n.nspname AS schema, c.relname AS name, c.relrowsecurity AS rls,
                (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
           FROM jsonb_to_recordset(${quoteSqlLiteral(JSON.stringify(wanted))}::jsonb) AS w(slug text, schema text, name text)
           JOIN pg_namespace n ON n.nspname = w.schema
           JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = w.name AND c.relkind IN ('r', 'p')`
    );
    const found: UnprotectedServedTable[] = [];
    for (const row of rows) {
        const qualified = `${String(row.schema)}.${String(row.name)}`;
        const plan = plans.get(qualified);
        const declaresPolicies = (plan?.policyStatements.length ?? 0) > 0;
        const rls = row.rls === true;
        const policies = Number(row.policies ?? 0);
        if (rls && (policies > 0 || !declaresPolicies)) continue;
        const enable = plan?.enableRls ?? `ALTER TABLE ${qualified} ENABLE ROW LEVEL SECURITY;`;
        const statements = rls ? plan?.policyStatements ?? [] : [enable, ...(plan?.policyStatements ?? [])];
        found.push({
            slug: String(row.slug),
            qualified,
            problem: rls ? "no-policies" : "rls-off",
            remediationSql: statements.join("\n")
        });
    }
    return found;
}

/** What a caller asking for a withheld table is told: the reason, never the SQL. */
export function withheldTableMessage(table: Pick<UnprotectedServedTable, "slug" | "problem">): string {
    return table.problem === "rls-off"
        ? `The table "${table.slug}" is not served: row-level security is disabled on it in the database, so every ` +
            "caller would reach every row. The server's boot log names the statements that protect it."
        : `The table "${table.slug}" is not served: it declares row-level security policies and the database has ` +
            "none on it. The server's boot log names the statements that create them.";
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
            : "it declares policies, and the database has none on it, so every read would answer nothing";
        logger.error(
            `🔒 [rls] Not serving "${table.slug}" (${table.qualified}): ${what}. This boot did not change that ` +
            "(it provisions nothing, or Postgres refused it). Run, as part of your change process (or `rebase db push`):\n" +
            table.remediationSql.split("\n").map(line => `      ${line}`).join("\n")
        );
    }
}
