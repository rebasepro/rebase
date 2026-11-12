/**
 * `rebase migrate collections-to-tables [dir]`: the command a project on the
 * `config/collections` layout runs to move to `backend/schema` (+
 * `frontend/src/cms`). The runtime and every CLI command refuse the old layout
 * with this command in the message (`LEGACY_LAYOUT_REMEDY`).
 *
 * Prints the plan and the outcome for a person, or one JSON document
 * (`--json`) for a script or an agent. Exits 1 when the run was refused or the
 * SQL check failed.
 */
import path from "node:path";
import chalk from "chalk";

import { migrateCollectionsToTables } from "./migrate";
import type { MigrationReport } from "./types";

/** The help page. */
export function printCollectionsToTablesHelp(): void {
    console.log(`
${chalk.bold("rebase migrate collections-to-tables")} — move a project from config/collections to backend/schema

${chalk.bold("Usage")}
  rebase migrate collections-to-tables [dir] [options]

  ${chalk.gray("dir")}   The project root (where rebase.json and config/ are). Default: the current directory.

${chalk.bold("What it writes")}
  backend/schema/<table>.ts      defineTable / defineAuthTable / defineView, one per collection
  backend/schema/index.ts        every table, and defaultRls when config/collections had defaultSecurityRules
  frontend/src/cms/<table>.tsx   customizeTable(...), only for a collection whose presentation was not the default
  frontend/src/cms/<name>.ts     defineFirestoreCollection(...), for engine: "firestore" collections
  backend/resources.ts, backend/storage.ts, backend/generated/register.ts   from their config/ counterparts
  rebase.json, package.json, pnpm-workspace.yaml, backend/tsconfig.json     without the config package

${chalk.bold("Options")}
  --dry-run   Print the plan; write nothing
  --check     Verify an already migrated project: the tables must render the same SQL as config/collections
  --json      One JSON document on stdout: files, refusals, notes, manual steps, the SQL check
  --force     Run on a dirty git tree, and replace output files that differ

${chalk.bold("Safety")}
  Every run evaluates config/collections as the server did, converts it, writes the result
  and reads it back through the new pipeline: the generated SQL (DDL, policies, search, vector,
  triggers, views, the Drizzle schema) must be byte-identical, or every file is put back.
  A construct the codemod cannot carry exactly is refused with its file and line, and nothing
  is written. config/ itself is never deleted: the run prints the git rm line to run.
`);
}

function printReport(report: MigrationReport): void {
    const tables = report.collections.filter(outcome => outcome.kind === "table" || outcome.kind === "auth-table" || outcome.kind === "view");
    const firestore = report.collections.filter(outcome => outcome.kind === "firestore");
    const customized = report.collections.filter(outcome => outcome.frontendFile !== undefined && outcome.kind !== "firestore");
    const refused = report.collections.filter(outcome => outcome.kind === "refused");
    console.log("");
    console.log(chalk.bold(`rebase migrate collections-to-tables — ${report.projectRoot}`));
    console.log("");
    if (report.collections.length > 0) {
        console.log(`  ${report.collections.length} collection(s): ${tables.length} table(s), ${firestore.length} Firestore, ${refused.length} refused; ${customized.length} customization file(s)`);
    }
    if (report.files.length > 0) {
        const changed = report.files.filter(file => file.action !== "unchanged");
        console.log("");
        console.log(chalk.bold(`  Files${report.status === "planned" || report.status === "blocked" ? " (planned)" : ""}: ${changed.length} to write, ${report.files.length - changed.length} unchanged`));
        for (const file of changed) console.log(`    ${file.action === "create" ? chalk.green("create") : chalk.yellow("update")} ${file.path}`);
    }
    if (report.refusals.length > 0) {
        console.log("");
        console.log(chalk.red.bold(`  Refused (${report.refusals.length}) — nothing was written:`));
        for (const refusal of report.refusals) {
            const where = `${refusal.file}${refusal.line !== undefined ? `:${refusal.line}` : ""}`;
            const what = [refusal.collection, refusal.key].filter(Boolean).join(".");
            console.log(`    ${chalk.red("✗")} ${where}${what ? ` (${what})` : ""}`);
            console.log(`      ${refusal.reason}`);
        }
    }
    if (report.notes.length > 0) {
        console.log("");
        console.log(chalk.bold(`  Notes (${report.notes.length}):`));
        for (const item of report.notes) {
            console.log(`    ${chalk.gray("·")} ${item.file ? `${item.file}${item.line !== undefined ? `:${item.line}` : ""} ` : ""}${item.message}`);
        }
    }
    if (report.manualSteps.length > 0) {
        console.log("");
        console.log(chalk.bold(`  Manual steps (${report.manualSteps.length}):`));
        report.manualSteps.forEach((step, index) => {
            console.log(`    ${index + 1}. ${chalk.bold(step.title)}${step.file ? chalk.gray(` (${step.file})`) : ""}`);
            console.log(`       ${step.detail}`);
            if (step.snippet) for (const line of step.snippet.split("\n")) console.log(chalk.cyan(`         ${line}`));
        });
    }
    const verification = report.verification;
    if (verification) {
        console.log("");
        if (verification.error) {
            console.log(chalk.red(`  ✗ SQL check could not run: ${verification.error}`));
        } else if (verification.identical) {
            console.log(chalk.green(`  ✓ SQL check: ${verification.compared} outputs byte-identical (DDL, policies, search, vector, triggers, views, Drizzle schema, boot plans)`));
        } else {
            console.log(chalk.red(`  ✗ SQL check: ${verification.differences.length} of ${verification.compared} outputs differ${report.status === "failed" ? " — every file was put back" : ""}`));
            for (const difference of verification.differences) {
                console.log(chalk.bold(`    ${difference.output}`));
                for (const line of difference.diff.split("\n")) console.log(`      ${line}`);
            }
        }
    }
    console.log("");
    switch (report.status) {
        case "migrated":
            console.log(chalk.green("  Migrated. Review the diff, do the manual steps, then remove the legacy files:"));
            break;
        case "already-migrated":
            console.log(chalk.green("  Already migrated: every file holds what the codemod would write, and the SQL matches. Remove the legacy files:"));
            break;
        case "checked":
            console.log(chalk.green("  The migrated schema matches config/collections. Remove the legacy files:"));
            break;
        case "planned":
            console.log("  Dry run: nothing was written. Run without --dry-run to migrate (the SQL check runs then).");
            break;
        default:
            break;
    }
    if (report.removeCommand) console.log(chalk.cyan(`    ${report.removeCommand}`));
    console.log("");
}

/**
 * Run the command.
 *
 * @param flags the parsed flags
 * @param dir the project directory, as typed
 * @param moduleAliases specifiers mapped to files for evaluating the project (the in-repo entry points `@rebasepro/*` at source)
 */
export async function runCollectionsToTables(
    flags: { check?: boolean; dryRun?: boolean; json?: boolean; force?: boolean },
    dir: string | undefined,
    moduleAliases?: Record<string, string>
): Promise<MigrationReport> {
    const projectRoot = path.resolve(dir ?? process.cwd());
    const report = await migrateCollectionsToTables({
        projectRoot,
        ...(flags.check ? { check: true } : {}),
        ...(flags.dryRun ? { dryRun: true } : {}),
        ...(flags.force ? { force: true } : {}),
        ...(moduleAliases ? { moduleAliases } : {})
    });
    if (flags.json) console.log(JSON.stringify(report, null, 2));
    else printReport(report);
    if (report.status === "blocked" || report.status === "failed") process.exitCode = 1;
    return report;
}
