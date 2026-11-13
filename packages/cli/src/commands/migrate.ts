/**
 * CLI command group: `rebase migrate <subcommand>` — one-way moves of a
 * project from a layout this release no longer reads.
 *
 * - `collections-to-tables [dir]` — `config/collections` → `backend/schema`
 *   (+ `frontend/src/cms`), proven by byte-identical generated SQL.
 * - `sdk-calls [dir]` — the project's own code for the renames that came with
 *   tables (`data.collection(…)` → `data.table(…)`, rule keys, hooks); part of
 *   the first, and on its own for a project already migrated.
 *
 * The work lives in `../codemod/collections-to-tables`, loaded only when the
 * command runs (it brings ts-morph), so `rebase --help` and every other command
 * start as fast as before.
 */
import chalk from "chalk";

import { parseCommandArgs, wantsHelp } from "../utils/args";
import { unknownCommandMessage } from "../utils/unknown-command";

/** The subcommands `rebase migrate` dispatches. The CLI's vocabulary and the docs verifier read this. */
export const MIGRATE_SUBCOMMANDS = ["collections-to-tables", "sdk-calls"] as const;

/** Every flag `rebase migrate collections-to-tables` accepts. Its help page and the docs verifier read this. */
export const COLLECTIONS_TO_TABLES_FLAGS = {
    "--check": Boolean,
    "--dry-run": Boolean,
    "--json": Boolean,
    "--force": Boolean,
    "--skip-sdk-calls": Boolean,
    "--accept-rule-changes": Boolean
} as const;

/** Every flag `rebase migrate sdk-calls` accepts. Its help page and the docs verifier read this. */
export const SDK_CALLS_FLAGS = {
    "--dry-run": Boolean,
    "--json": Boolean,
    "--force": Boolean
} as const;

function printHelp(): void {
    console.log(`
${chalk.bold("rebase migrate")} — move a project from a layout this release no longer reads

${chalk.bold("Usage")}
  rebase migrate <subcommand> [dir] [options]

${chalk.bold("Subcommands")}
  ${chalk.blue.bold("collections-to-tables")} ${chalk.gray("[dir]")}   config/collections → backend/schema + frontend/src/cms, SQL-checked.
                                Run it once, on a project the CLI refuses with "still on the collections layout".
                                It runs sdk-calls too, unless --skip-sdk-calls.
  ${chalk.blue.bold("sdk-calls")} ${chalk.gray("[dir]")}               data.collection("x") → data.table("x"), the rule keys (existsIn / membership:
                                collection → table) and the other renames, in your own code — including imports
                                of names that moved package (@rebasepro/types / common → @rebasepro/cms-types, …),
                                adding that package to your package.json. Run it alone on a project already
                                migrated, or after a migration run with --skip-sdk-calls.

${chalk.bold("Options")} ${chalk.gray("(each subcommand's --help lists its own)")}
  --dry-run   Print the plan and write nothing. Start here.
  --check     ${chalk.gray("(collections-to-tables)")} On a project already migrated: prove backend/schema still renders
              the same SQL as config/collections, before you delete config/. Writes nothing.
  --force     Run on a git tree with uncommitted changes (the run refuses one, so every change it
              makes is a reviewable diff), and replace output files that hold something else.
  --json      One JSON document on stdout, for a script or an agent.

${chalk.bold("Manual steps")}
  What the codemod cannot do safely for you is printed at the end of a run as a numbered list,
  each with the file it is about and the code to paste: mount the customizations, move a module
  it did not read, repoint an import of config/, regenerate the SDK, refresh the agent skills.
  The migration is finished when the list is done and config/ is removed.

Run ${chalk.cyan("rebase migrate <subcommand> --help")} for the rest.
`);
}

/**
 * Run `rebase migrate <subcommand>`.
 *
 * @param subcommand the word after `migrate`
 * @param rawArgs the whole command line
 */
export async function migrateCommand(subcommand: string | undefined, rawArgs: string[]): Promise<void> {
    switch (subcommand) {
        case "collections-to-tables": {
            const { printCollectionsToTablesHelp, runCollectionsToTables } = await import("../codemod/collections-to-tables/command");
            if (wantsHelp(rawArgs)) {
                printCollectionsToTablesHelp();
                return;
            }
            const { flags, positionals } = parseCommandArgs({
                spec: COLLECTIONS_TO_TABLES_FLAGS,
                rawArgs,
                commandWords: 1,
                command: "migrate collections-to-tables",
                maxPositionals: 2
            });
            await runCollectionsToTables({
                check: flags["--check"] === true,
                dryRun: flags["--dry-run"] === true,
                json: flags["--json"] === true,
                force: flags["--force"] === true,
                skipSdkCalls: flags["--skip-sdk-calls"] === true,
                acceptRuleChanges: flags["--accept-rule-changes"] === true
            }, positionals[1]);
            return;
        }
        case "sdk-calls": {
            const { printSdkCallsHelp, runSdkCalls } = await import("../codemod/collections-to-tables/command");
            if (wantsHelp(rawArgs)) {
                printSdkCallsHelp();
                return;
            }
            const { flags, positionals } = parseCommandArgs({
                spec: SDK_CALLS_FLAGS,
                rawArgs,
                commandWords: 1,
                command: "migrate sdk-calls",
                maxPositionals: 2
            });
            await runSdkCalls({
                dryRun: flags["--dry-run"] === true,
                json: flags["--json"] === true,
                force: flags["--force"] === true
            }, positionals[1]);
            return;
        }
        // Bare `rebase migrate`: the CLI hands a group with no subcommand
        // `"--help"` as its subcommand, and that printed "Unknown migrate
        // command" for the one line most likely to be typed first.
        case undefined:
        case "--help":
        case "-h":
        case "help":
            printHelp();
            return;
        default:
            if (wantsHelp(rawArgs)) {
                printHelp();
                return;
            }
            // Two subcommands: name both, whatever was typed.
            console.error(chalk.red(`✗ ${unknownCommandMessage(subcommand, MIGRATE_SUBCOMMANDS, "migrate")} ` +
                `The subcommands are ${MIGRATE_SUBCOMMANDS.join(" and ")}.`));
            process.exit(1);
    }
}
