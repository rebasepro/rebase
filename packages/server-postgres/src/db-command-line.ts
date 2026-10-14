/**
 * Every `rebase db …` line this driver answers, judged without connecting to
 * anything.
 *
 * The driver refuses a flag a command does not take, but it is spawned only
 * once the CLI has a database for it, and getting one means starting one: the
 * remembered compose container, or the managed PGlite daemon. So `rebase db
 * push --dry-rn` booted the database and then said the flag did not exist.
 * The CLI runs this first, from the driver's own code, so the answer it gives
 * before starting anything and the one the driver would give after are one
 * check, not two lists to keep in step.
 *
 * Each entry calls the parse its command runs itself, never a copy of it.
 */
import { assertKnownFlags } from "./cli-flags";
import { assertKnownBranchFlags } from "./branch-argv";
import { backupActionOf } from "./backup-argv";
import { parseBackupLine, parseBackupsListLine, parseRestoreLine } from "./backup/backup-cli";
import { isDriverDbSubcommand, type DriverDbSubcommand } from "./db-subcommands";

/**
 * The check each subcommand's line gets. A `Record` over the union, so a
 * subcommand added to `DRIVER_DB_SUBCOMMANDS` does not compile until it says
 * how its line is judged.
 */
const LINE_CHECKS: Record<DriverDbSubcommand, (args: string[]) => void> = {
    push: args => assertKnownFlags("db", "push", args),
    generate: args => assertKnownFlags("db", "generate", args),
    migrate: args => assertKnownFlags("db", "migrate", args),
    // The action's own table; an action the table does not list is the
    // dispatch's to answer, in its own words.
    branch: (args) => {
        if (args[2] !== undefined) assertKnownBranchFlags(args[2], args.slice(3));
    },
    backup: (args) => {
        if (backupActionOf(args) === "list") parseBackupsListLine(args);
        else parseBackupLine(args);
    },
    restore: (args) => { parseRestoreLine(args); },
    backups: (args) => {
        if (args[2] === "list") parseBackupsListLine(args);
    }
};

/**
 * Throw what the driver would say of a `rebase db …` line it refuses on its
 * flags, before it would connect: an option the command does not take, and
 * the checks `db backup` and `db restore` make of their own line (a stray
 * word, a pattern that leaves out the rebase schema).
 *
 * Reads no environment and opens nothing, so it is safe to run before a
 * database exists.
 *
 * @param args the driver's line: `["db", "<subcommand>", …]`, without the
 *   CLI's own words in front. A line for a subcommand this driver does not
 *   answer passes, for the dispatch to refuse.
 */
export function assertDbCommandLine(args: readonly string[]): void {
    const [domain, subcommand] = args;
    if (domain !== "db" || !isDriverDbSubcommand(subcommand)) return;
    // `--help` is answered before any check, by the CLI and by the dispatch.
    if (args.includes("--help") || args.includes("-h")) return;
    LINE_CHECKS[subcommand]([...args]);
}
