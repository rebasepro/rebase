/**
 * `rebase migrate collections-to-tables [dir]`: the command a project on the
 * `config/collections` layout runs to move to `backend/schema` (+
 * `frontend/src/cms`). The runtime and every CLI command refuse the old layout
 * with this command in the message (`LEGACY_LAYOUT_REMEDY`).
 *
 * Prints the plan and the outcome for a person, or one JSON document
 * (`--json`) for a script or an agent. Exits 1 when the run was refused, the
 * SQL check failed, or `--check` found rules that change meaning without
 * `--accept-rule-changes`.
 */
import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";

import { gitState, migrateCollectionsToTables } from "./migrate";
import { rewriteSdkCalls, type SdkRewriteReport } from "./sdk-calls";
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

${chalk.bold("When to use it")}
  Once, on a project every other command refuses with "still on the collections layout".
  Commit first: the run refuses a dirty git tree, so what it changes is one reviewable diff.

${chalk.bold("Options")}
  --dry-run   Print the plan (files, refusals, manual steps) and write nothing. Start here.
  --check     On a project already migrated, before deleting config/: prove backend/schema still
              renders the same SQL as config/collections. Writes nothing; exits 1 with the diff if not.
  --json      One JSON document on stdout: files, refusals, notes, manual steps, the SQL check
  --force     Run on a dirty git tree, and replace output files that hold something else
              (an earlier run's output you edited). Without it, both are refused and nothing is written.
  --skip-sdk-calls  Leave the project's own code as it is; run rebase migrate sdk-calls later
  --accept-rule-changes  With --check: the rules listed under "Review before deploying" were reviewed.
              Without it, --check exits 1 while any rule changes meaning.

${chalk.bold("Manual steps")}
  What the codemod cannot carry exactly is not guessed at: it is printed at the end as a numbered
  list of manual steps, each with the file it is about and, where there is one, the code to paste —
  mounting the customizations in <RebaseCMS tableCustomizations>, a module of config/ it did not
  read, an import of config/ to repoint, regenerating the SDK, refreshing the agent skills.
  The migration is done when the list is done and config/ is removed (the run prints the git rm line).

${chalk.bold("Safety")}
  Every run evaluates config/collections as the server did, converts it, writes the result
  and reads it back through the new pipeline: the generated SQL (DDL, policies, search, vector,
  triggers, views, the Drizzle schema) must be byte-identical, or every file is put back.
  A construct the codemod cannot carry exactly is refused with its file and line, and nothing
  is written. config/ itself is never deleted: the run prints the git rm line to run.

  That check compiles both sides with this release's compiler, so it proves the files were
  converted faithfully, not that a rule still MEANS what it did. Two things cover that:
  ${chalk.bold("Review before deploying")} — printed last — lists every security rule whose policy now grants
  something different (e.g. a bare access: "authenticated", which granted nothing before and
  admits every signed-in caller now). And against the project's database, after migrating:
    rebase db push --dry-run     expect "No changes: the database already matches these tables."
    rebase doctor --policies     expect no policy drift
  Any policy difference either lists is a change in who can access what.
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
    if (report.sdk) printSdkSection(report.sdk);
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
    if (report.status === "rule-changes") {
        console.log(chalk.red("  The migrated schema matches config/collections, but rules change meaning (below). Review them, then run"));
        console.log(chalk.red("  --check again with --accept-rule-changes."));
    }
    if (report.removeCommand) console.log(chalk.cyan(`    ${report.removeCommand}`));
    if (report.status === "migrated" || report.status === "already-migrated" || report.status === "checked" || report.status === "rule-changes") {
        console.log("");
        console.log("  The SQL check proves the files were converted faithfully, not what the rules mean. Before deploying,");
        console.log("  against the project's database:");
        console.log(chalk.cyan("    rebase db push --dry-run") + chalk.gray("   expect \"No changes: the database already matches these tables.\""));
        console.log(chalk.cyan("    rebase doctor --policies") + chalk.gray("   expect no policy drift"));
        console.log("  Any policy difference either lists is a change in who can access what.");
    }
    printRuleChanges(report);
    console.log("");
}

/** The rules that change meaning: last, so they cannot scroll away. */
function printRuleChanges(report: MigrationReport): void {
    if (report.ruleChanges.length === 0) return;
    console.log("");
    console.log(chalk.red.bold(`  ⚠ Review before deploying: these rules change meaning (${report.ruleChanges.length})`));
    console.log(chalk.red("    Each is carried as written and keeps its policy name, but the policy now grants something different."));
    for (const change of report.ruleChanges) {
        console.log(`    ${chalk.red("!")} ${change.file} (${change.collection} ${change.rule})`);
        console.log(`      ${change.message}`);
    }
}

/**
 * Run the command.
 *
 * @param flags the parsed flags
 * @param dir the project directory, as typed
 * @param moduleAliases specifiers mapped to files for evaluating the project (the in-repo entry points `@rebasepro/*` at source)
 */
export async function runCollectionsToTables(
    flags: { check?: boolean; dryRun?: boolean; json?: boolean; force?: boolean; skipSdkCalls?: boolean; acceptRuleChanges?: boolean },
    dir: string | undefined,
    moduleAliases?: Record<string, string>
): Promise<MigrationReport> {
    const projectRoot = path.resolve(dir ?? process.cwd());
    const report = await migrateCollectionsToTables({
        projectRoot,
        ...(flags.check ? { check: true } : {}),
        ...(flags.dryRun ? { dryRun: true } : {}),
        ...(flags.force ? { force: true } : {}),
        ...(flags.skipSdkCalls ? { skipSdkCalls: true } : {}),
        ...(flags.acceptRuleChanges ? { acceptRuleChanges: true } : {}),
        ...(moduleAliases ? { moduleAliases } : {})
    });
    if (flags.json) console.log(JSON.stringify(report, null, 2));
    else printReport(report);
    if (report.status === "blocked" || report.status === "failed" || report.status === "rule-changes") process.exitCode = 1;
    return report;
}

/** The SDK-call rewrite's part of a report. */
function printSdkSection(sdk: SdkRewriteReport): void {
    const total = Object.values(sdk.counts).reduce((sum, count) => sum + (count ?? 0), 0);
    console.log("");
    console.log(chalk.bold(`  SDK calls: ${total} rewrite(s) in ${sdk.files.length} file(s)${sdk.typeAware ? " (receivers checked by type where a program could be built)" : ""}`));
    for (const [rule, count] of Object.entries(sdk.counts)) console.log(`    ${rule}: ${count}`);
    if (sdk.dependencies.length > 0) {
        console.log(chalk.bold(`  Dependencies added (${sdk.dependencies.length}) — imports moved to these packages; run your package manager's install:`));
        for (const added of sdk.dependencies) console.log(`    ${added.file}: ${chalk.green(`"${added.name}": "${added.version}"`)}`);
    }
    if (sdk.byName.length > 0) {
        console.log(chalk.yellow(`  Rewritten by name — review (${sdk.byName.length}): the receiver has no type, so its name (\`dataAsAdmin\`, \`.data\` with a literal table) decided:`));
        for (const entry of sdk.byName) console.log(`    ${entry.file}:${entry.line} ${chalk.gray(entry.code)}`);
    }
    if (sdk.left.length > 0) {
        console.log(chalk.yellow(`  Left unchanged (${sdk.left.length}) — check each:`));
        for (const left of sdk.left) console.log(`    ${left.file}:${left.line} ${chalk.gray(left.code)} — ${left.reason}`);
    }
}

/** The help page of `rebase migrate sdk-calls`. */
export function printSdkCallsHelp(): void {
    console.log(`
${chalk.bold("rebase migrate sdk-calls")} — rewrite a project's own code for the SDK rename

${chalk.bold("Usage")}
  rebase migrate sdk-calls [dir] [--dry-run] [--json] [--force]

  Part of ${chalk.cyan("rebase migrate collections-to-tables")}; run it alone on a project already migrated.
  data.collection("x") → data.table("x") on the SDK data surface, createRebaseClient options,
  generated type names, batch operations, error codes, offline options, typed accessors,
  setCollectionCallbacks → setTableHooks (hook props adapted), storageAuthorize data, and the
  rule keys: existsIn({ collection: X }) and membership: { collection: X } → table: X.
  A .collection( call whose receiver is not the SDK is left as written and listed.
  Generated SDK files are not rewritten: run rebase generate-sdk.

  Imports of names 0.31 moved to another package (the admin-panel helpers and types that left
  @rebasepro/types and @rebasepro/common for @rebasepro/cms-types, the migration lift now in
  @rebasepro/common/migrate) are moved to it — merged into an import the file has, import type,
  inline type and as aliases kept — and renamed exports (reviewSecurityRules → reviewRls,
  assertUploadWithinPropertyLimits → assertUploadWithinColumnLimits, …) are renamed with their
  references. A package an import now names is added to that workspace package's dependencies,
  at the range of its other @rebasepro packages.

${chalk.bold("When to use it")}
  On a project already migrated (or migrated with --skip-sdk-calls), and again after pulling in
  code written against the old names. A second run on rewritten code changes nothing.

${chalk.bold("Options")}
  --dry-run   Print what would change; write nothing
  --json      One JSON document on stdout
  --force     Run on a dirty (or absent) git tree. Without it the run refuses, so its edits stay one diff.

${chalk.bold("Manual steps")}
  What it cannot rewrite safely is printed after the counts as a numbered list, each with the file,
  the line and what to write instead: a boot option it cannot prove, a generated SDK file, an export
  that was removed or now means something else, a namespace import, export * or dynamic import that
  uses a moved name, an option, variable, route or MCP tool name whose meaning changed, an old CLI
  flag in a package.json script. Each points at its section of the upgrade guide.
`);
}

/**
 * Run \`rebase migrate sdk-calls\`.
 *
 * @param dir the project directory, as typed
 * @param aliases specifiers mapped to files, for the type checker (in-repo runs)
 */
export async function runSdkCalls(flags: { dryRun?: boolean; json?: boolean; force?: boolean }, dir: string | undefined, aliases?: Record<string, string>): Promise<SdkRewriteReport | undefined> {
    const root = path.resolve(dir ?? process.cwd());
    if (!flags.dryRun && !flags.force) {
        const state = gitState(root);
        if (!state.clean) {
            if (flags.json) console.log(JSON.stringify({ error: { message: state.reason, code: "dirty_tree" } }, null, 2));
            else console.error(chalk.red(`✗ ${state.reason}`));
            process.exitCode = 1;
            return undefined;
        }
    }
    const legacyConfig = path.join(root, "config", "collections");
    const { files, report } = await rewriteSdkCalls(root, { skipDirs: [legacyConfig], ...(aliases ? { aliases } : {}) });
    if (!flags.dryRun) for (const [file, content] of files) fs.writeFileSync(file, content);
    if (flags.json) {
        console.log(JSON.stringify({ status: flags.dryRun ? "planned" : files.size > 0 ? "rewritten" : "nothing-to-do", ...report }, null, 2));
    } else {
        console.log(chalk.bold(`\nrebase migrate sdk-calls — ${root}`));
        printSdkSection(report);
        if (report.manualSteps.length > 0) console.log(chalk.bold(`\n  Manual steps (${report.manualSteps.length}):`));
        report.manualSteps.forEach((step, index) => {
            console.log(`    ${index + 1}. ${chalk.bold(step.title)}${step.file ? chalk.gray(` (${step.file})`) : ""}`);
            console.log(`       ${step.detail}`);
            if (step.snippet) for (const line of step.snippet.split("\n")) console.log(chalk.cyan(`         ${line}`));
        });
        console.log(flags.dryRun ? "\n  Dry run: nothing was written.\n" : files.size > 0 ? "\n  Rewritten. Review the diff, then run your type check.\n" : "\n  Nothing to rewrite.\n");
    }
    return report;
}
