/**
 * `rebase doctor --database`: whether this database can host Rebase's request
 * role(s) under the project's `rls` settings, read from the catalogue without
 * changing anything.
 *
 * Lives beside `doctor-cli.ts` rather than inside it because that file runs
 * `main()` on import; the rendering and the table list are tested here.
 */
import chalk from "chalk";
import type { CollectionConfig } from "@rebasepro/types";
import { isPostgresCollectionConfig } from "@rebasepro/types";
import { getTableName, relationalCollections, resolveJunctionSpecs } from "@rebasepro/common";
import type { PreflightFinding } from "../security/database-preflight";
import type { ManagedTable, RawSqlRunner } from "../security/rls-enforcement";
import type { RlsSettings } from "../security/rls-settings";
import type { PolicyCheckStatus } from "./doctor-policy-checks";

/**
 * The tables Rebase serves, as the server would list them: every relational
 * collection's table in its schema (`public` by default), and every junction
 * table a many-to-many declares.
 */
export function managedTablesOf(collections: CollectionConfig[]): ManagedTable[] {
    const relational = relationalCollections(collections);
    const tables = new Map<string, ManagedTable>();
    const add = (schema: string, table: string) => tables.set(`${schema}.${table}`, { schema, table });
    for (const collection of relational) {
        const schema = isPostgresCollectionConfig(collection) && collection.schema ? collection.schema : "public";
        add(schema, getTableName(collection));
    }
    for (const spec of resolveJunctionSpecs(relational).values()) add(spec.schema, spec.table);
    return [...tables.values()];
}

/** The schemas Rebase writes to: `public`, `rebase`, and every schema a collection names. */
export function preflightSchemasOf(collections: CollectionConfig[]): string[] {
    return Array.from(new Set([
        "public",
        "rebase",
        ...relationalCollections(collections)
            .filter(isPostgresCollectionConfig)
            .map((c) => c.schema)
            .filter((s): s is string => !!s)
    ]));
}

const LEVEL_ORDER: PreflightFinding["level"][] = ["fail", "warn", "ok"];
const LEVEL_TITLE: Record<PreflightFinding["level"], string> = {
    fail: "Needs fixing before Rebase can serve requests here",
    warn: "Worth a look",
    ok: "Fine"
};
const LEVEL_MARK: Record<PreflightFinding["level"], string> = {
    fail: chalk.red("✗"),
    warn: chalk.yellow("⚠"),
    ok: chalk.green("✓")
};

/**
 * The report, grouped by level, failures first. Each finding that is not fine
 * shows the SQL to run as an administrator in gray, and the `rls` setting that
 * would fit Rebase to the database instead.
 */
export function renderPreflightFindings(
    findings: readonly PreflightFinding[],
    settings: Pick<RlsSettings, "roles" | "nonDefaults">
): string[] {
    const lines: string[] = [];
    lines.push(chalk.bold("  Database preflight"));
    lines.push(chalk.gray(
        `    Request role(s): ${settings.roles.join(", ")}. ` +
        (settings.nonDefaults.length > 0 ? `Non-default settings: ${settings.nonDefaults.join(", ")}.` : "The other rls settings are at their defaults.")
    ));
    for (const level of LEVEL_ORDER) {
        const group = findings.filter((f) => f.level === level);
        if (group.length === 0) continue;
        lines.push("");
        lines.push(`  ${LEVEL_TITLE[level]}`);
        for (const finding of group) {
            lines.push(`  ${LEVEL_MARK[level]} ${finding.check}: ${finding.detail}`);
            if (finding.sql) {
                for (const sqlLine of finding.sql.split("\n")) lines.push(chalk.gray(`      ${sqlLine}`));
            }
            if (finding.setting) lines.push(chalk.cyan(`      ${finding.sql ? "or set" : "set"}: ${finding.setting}`));
        }
    }
    return lines;
}

/** `ok` when nothing failed; `problems` when a finding is a failure. Warnings do not fail the run. */
export function preflightStatus(findings: readonly PreflightFinding[]): PolicyCheckStatus {
    return findings.some((f) => f.level === "fail") ? "problems" : "ok";
}

/**
 * Every table in `schemas` but `rebase`: what a project with no declared
 * collections serves, since its API is introspected from the database.
 */
async function everyTableIn(run: RawSqlRunner, schemas: readonly string[]): Promise<ManagedTable[]> {
    const names = schemas.filter((s) => s !== "rebase").map((s) => `'${s.replace(/'/g, "''")}'`);
    if (names.length === 0) return [];
    const rows = await run(`
        SELECT n.nspname AS schema, c.relname AS name
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN (${names.join(", ")}) AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
        ORDER BY 1, 2
    `);
    return rows.map((r) => ({ schema: String(r.schema), table: String(r.name) }));
}

/**
 * Run the preflight against `databaseUrl` with the settings a command outside
 * the server sees (`REBASE_RLS_*`, else the roles recorded in the database),
 * and print it. Never reports `ok` for a check it could not run.
 */
export async function runDatabasePreflight(schemaDir: string, databaseUrl?: string): Promise<PolicyCheckStatus> {
    if (!databaseUrl) {
        console.error(chalk.yellow("  ⚠ No DATABASE_URL — the database preflight did NOT run"));
        return "unchecked";
    }

    const { loadTables } = await import("./load-tables");
    const { lowerCompiledTables } = await import("./lowered-tables");
    const { preflightDatabase } = await import("../security/database-preflight");
    const { readRecordedRequestRoles } = await import("../security/rls-enforcement");
    const { cliRlsSettings } = await import("../security/rls-settings");
    const { Pool } = await import("pg");

    const pool = new Pool({ connectionString: databaseUrl });
    try {
        const run: RawSqlRunner = async (text) => (await pool.query(text)).rows as Record<string, unknown>[];
        // B-PLAN-2 step 6: the table list from the descriptors.
        const collections = lowerCompiledTables(await loadTables(schemaDir));
        // Only the schemas that exist: the SQL a finding carries grants on each
        // one, and a GRANT on a missing schema fails the whole script. A boot
        // grants on the ones it creates itself.
        const existing = new Set((await run("SELECT nspname FROM pg_namespace")).map((row) => String(row.nspname)));
        const schemas = preflightSchemasOf(collections).filter((schema) => existing.has(schema));
        const settings = cliRlsSettings(await readRecordedRequestRoles(run));

        let managedTables = managedTablesOf(collections);
        console.log("");
        if (managedTables.length === 0) {
            managedTables = await everyTableIn(run, schemas);
            console.log(chalk.gray("  No declared tables: every table in public is treated as served, as an introspected project serves them."));
        }

        const findings = await preflightDatabase(run, settings, { schemas, managedTables });
        for (const line of renderPreflightFindings(findings, settings)) console.log(line);
        console.log("");
        return preflightStatus(findings);
    } catch (err) {
        console.error(chalk.red("  ✗ Could not run the database preflight:"), err instanceof Error ? err.message : String(err));
        return "unchecked";
    } finally {
        await pool.end();
    }
}
