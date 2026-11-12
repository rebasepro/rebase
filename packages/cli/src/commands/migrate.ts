/**
 * CLI command group: `rebase migrate <subcommand>` — one-way moves of a
 * project from a layout this release no longer reads.
 *
 * - `collections-to-tables [dir]` — `config/collections` → `backend/schema`
 *   (+ `frontend/src/cms`), proven by byte-identical generated SQL.
 *
 * The work lives in `../codemod/collections-to-tables`, loaded only when the
 * command runs (it brings ts-morph), so `rebase --help` and every other command
 * start as fast as before.
 */
import chalk from "chalk";

import { parseCommandArgs, wantsHelp } from "../utils/args";
import { unknownCommand } from "../utils/unknown-command";

/** The subcommands `rebase migrate` dispatches. The CLI's vocabulary and the docs verifier read this. */
export const MIGRATE_SUBCOMMANDS = ["collections-to-tables", "sdk-calls"] as const;

/** Every flag `rebase migrate collections-to-tables` accepts. Its help page and the docs verifier read this. */
export const COLLECTIONS_TO_TABLES_FLAGS = {
    "--check": Boolean,
    "--dry-run": Boolean,
    "--json": Boolean,
    "--force": Boolean,
    "--skip-sdk-calls": Boolean
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
  rebase migrate <subcommand> [options]

${chalk.bold("Subcommands")}
  ${chalk.blue.bold("collections-to-tables")} ${chalk.gray("[dir]")}   config/collections → backend/schema + frontend/src/cms, SQL-checked
  ${chalk.blue.bold("sdk-calls")} ${chalk.gray("[dir]")}               data.collection("x") → data.table("x") and the other SDK renames, in your own code

Run ${chalk.cyan("rebase migrate <subcommand> --help")} for its options.
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
                skipSdkCalls: flags["--skip-sdk-calls"] === true
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
        case undefined:
            printHelp();
            return;
        default:
            if (wantsHelp(rawArgs)) {
                printHelp();
                return;
            }
            unknownCommand(subcommand, MIGRATE_SUBCOMMANDS, "migrate");
    }
}
