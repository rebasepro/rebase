/**
 * Which of the two things `rebase db backup …` means.
 *
 * The cloud family spells the listing `rebase cloud db backup list`. Locally
 * the same words *created a backup*: `backup` dispatched straight to
 * `backupCommand`, which parsed permissively and dropped "list" into the
 * positionals it never reads. One CLI, two spellings, and the wrong guess wrote
 * a dump instead of reading one — quiet, slow, and on a large database not
 * free.
 *
 * A separate module for the same reason `branch-argv.ts` is one: the decision
 * is pure, and the dispatch it lives in cannot be imported without loading the
 * environment and reaching for a database.
 */
export type BackupAction = "create" | "list";

/**
 * @param rawArgs the driver's whole line, `["db", "backup", …]`.
 */
export function backupActionOf(rawArgs: readonly string[]): BackupAction {
    return rawArgs[2] === "list" ? "list" : "create";
}
