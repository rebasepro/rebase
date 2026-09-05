/**
 * What to say when a spawned child process fails.
 *
 * Two failures arrive through the same `catch` and need opposite treatment:
 *
 *  - **The child ran and exited non-zero.** It had inherited stdio, so it has
 *    already printed its own diagnostics. execa's "Command failed with exit
 *    code 1: …" is a second, worse copy of the same news with the whole argv
 *    appended.
 *  - **The child never started.** ENOENT on the tsx binary, EACCES on a script
 *    that lost its permissions, ENOMEM on a full machine. Nobody printed
 *    anything, because nothing ran. `schema.ts` and `doctor.ts` both swallowed
 *    these — `catch { process.exit(1); }`, the error not even bound — so
 *    `rebase schema generate` against a broken tsx exited 1 in silence, and so
 *    did `rebase doctor`, the command whose entire job is to say what is wrong.
 *
 * The tsx symlink surviving a cleaned pnpm store is the ordinary way to get
 * here: `resolveLocalBin` finds the symlink, so "dependencies are not
 * installed" never fires, and the spawn is where it breaks.
 *
 * ## Why the message is not what decides it
 *
 * `db.ts` did make this distinction, by testing the message against
 * `/Command failed|exited with code/i` — and that test is wrong for every case
 * it was written to catch. execa prefixes **all** of them the same way:
 *
 *     Command failed with exit code 3: /bin/sh -c 'exit 3'
 *     Command failed with ENOENT: /…/tsx x⏎spawn /…/tsx ENOENT
 *     Command failed with EACCES: /…/tsx x⏎spawn /…/tsx EACCES
 *
 * So the filter matched the spawn failures too and `db push` was as silent as
 * the other two. The structured fields do distinguish them: a child that ran
 * has a numeric `exitCode` (or a `signal`, if something killed it), and a child
 * that never started has neither — only an errno in `code`.
 */
import chalk from "chalk";

interface ChildProcessFailure {
    exitCode?: unknown;
    signal?: unknown;
    /** execa's message without the "Command failed with …: <argv>" preamble. */
    originalMessage?: unknown;
}

/** Did the process start? Only then has anything else already been printed. */
function childRan(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const failure = error as Error & ChildProcessFailure;
    return typeof failure.exitCode === "number" || typeof failure.signal === "string";
}

export function reportSpawnFailure(error: unknown): void {
    if (childRan(error) || !(error instanceof Error)) return;

    // `originalMessage` is "spawn /…/tsx ENOENT" — the same fact as `message`
    // without a second copy of the argv the user just typed. Absent on the
    // errors these commands raise themselves, which are already one sentence.
    const failure = error as Error & ChildProcessFailure;
    const message = typeof failure.originalMessage === "string"
        ? failure.originalMessage
        : error.message;
    if (message) console.error(chalk.red(`✗ ${message}`));
}
