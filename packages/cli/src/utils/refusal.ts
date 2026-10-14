/**
 * A refusal the CLI raised itself, having said why: nothing broke.
 *
 * `bin/rebase.js` ends every failure with "Re-run with --debug for the stack
 * trace." That is right when something broke inside a command, and noise after
 * a check that decided not to run — the compose-port refusal prints the
 * container holding the port and how to move, and its stack points at the line
 * that decided to refuse. A `UsageError` (`utils/args.ts`) is the same case for
 * a command line that was wrong; this is the one for everything else.
 *
 * Marked with a property rather than left to `instanceof`, for `UsageError`'s
 * reason: the reader is `bin/rebase.js`, which imports the bundle, so the class
 * it would test against is not the one this file compiled to.
 */
export class Refusal extends Error {
    readonly isRefusal = true;

    constructor(message: string) {
        super(message);
        this.name = "Refusal";
    }
}
