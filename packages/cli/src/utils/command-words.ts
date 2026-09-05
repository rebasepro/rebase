/**
 * The words that name a command, with the flags taken back out.
 *
 * `rawArgs` is the whole of `process.argv`, and reading the command's words at
 * fixed indices off it assumes nothing precedes them. Something routinely does:
 * `--debug` is what `bin/rebase.js` prints after every failure as the thing to
 * re-run with, so it is the single most likely token to appear before a command
 * word, and it shifted every index by one.
 *
 * What that cost is not a bad error message. `rebase db branch switch feature`
 * writes a per-checkout pointer that the CLI owns; the driver, running as a
 * child process, cannot persist it and does not try. The dispatch found
 * `switch` by position, so `rebase --debug db branch switch feature` missed the
 * CLI's branch and handed the line to the driver — which reported success and
 * left the checkout on the main database. Every subsequent `dev`, `push` and
 * `backup` then ran against the wrong database, believing it was the branch,
 * which is the exact failure branching exists to prevent.
 *
 * The words are anchored on the command name rather than taken from position
 * zero, because a flag written in the space form (`--database-url <url>`) leaves
 * its value behind as a bare token and no parser at this level knows which
 * flags take values. Anchoring survives that: the value would have to be the
 * literal command name to fool it.
 *
 * Returns `[]` when the command name is not on the line at all.
 */
export function commandWords(rawArgs: readonly string[], command: string): string[] {
    const words = rawArgs.slice(2).filter(token => !token.startsWith("-"));
    const start = words.indexOf(command);
    return start === -1 ? [] : words.slice(start);
}

/**
 * The line to hand a spawned driver, starting at the command word.
 *
 * The same defect one layer down, and it does not degrade gracefully: the
 * driver reads its domain from `args[0]`, so `rebase --debug db push` spawned
 * it with `["--debug", "db", "push"]` and it answered "Unknown domain command:
 * --debug" — for a flag the CLI itself tells you to add after any failure.
 *
 * Tokens written *before* the command word are moved after it rather than
 * dropped. Dropping them would be the same class of bug in the other direction:
 * `rebase --database-url postgres://… db push` would silently lose the flag that
 * says which database to touch. Appending keeps each flag next to its value, and
 * `arg` reads flags wherever they appear.
 *
 * Falls back to `rawArgs.slice(2)` when the command word is not on the line,
 * which is what an internally synthesised argv looks like.
 */
export function argsFromCommand(rawArgs: readonly string[], command: string): string[] {
    const tail = rawArgs.slice(2);
    const start = tail.findIndex(token => token === command);
    if (start <= 0) return [...tail];
    return [...tail.slice(start), ...tail.slice(0, start)];
}
