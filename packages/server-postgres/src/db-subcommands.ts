/**
 * The `db` subcommands this driver dispatches, with no runtime dependencies.
 *
 * Its own module so the dispatch in `cli.ts` can name them without loading
 * what judges their lines (`db-command-line.ts` reaches the backup module,
 * which `cli.ts` imports only when a backup command runs).
 */
export const DRIVER_DB_SUBCOMMANDS = ["push", "generate", "migrate", "branch", "backup", "restore", "backups"] as const;

export type DriverDbSubcommand = typeof DRIVER_DB_SUBCOMMANDS[number];

/** Is `word` a `db` subcommand this driver answers? */
export function isDriverDbSubcommand(word: string | undefined): word is DriverDbSubcommand {
    return DRIVER_DB_SUBCOMMANDS.some(subcommand => subcommand === word);
}
