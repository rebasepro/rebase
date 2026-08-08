/**
 * Argument parsing for the commands that take positional arguments.
 *
 * Every command in the small group used to parse its own line the same way:
 * `arg(spec, { argv: rawArgs.slice(4), permissive: true })`, then read `_[0]`
 * and `_[1]`. Both halves of that are wrong in a way that costs data.
 *
 *  - **`permissive: true` turns an unknown flag into a positional.** `arg`
 *    pushes an undeclared flag into `_` as a bare token, so `_[1]` is whatever
 *    came second on the line, flag or not. `rebase auth reset-password
 *    bob@example.com --debug` set Bob's password to the literal `--debug` — and
 *    `--debug` is what `bin/rebase.js` prints after *every* failure as the thing
 *    to re-run with, so the single most likely next keystroke after a failed
 *    reset was the one that reset the account to a two-word string.
 *  - **`slice(4)` assumes the command words are at fixed indices.** They are
 *    not: a flag before the command shifts everything, so `rebase --debug auth
 *    reset-password bob@example.com NewPass1!` read the email as
 *    `reset-password` and the password as `bob@example.com`.
 *
 * So: parse the *whole* line — `rawArgs` is `process.argv` — against a spec
 * strictly, with no permissive mode. `arg` then consumes every flag wherever it
 * appears and rejects the ones nobody declared, which leaves `_` holding the
 * command words followed by the real positionals, in order and at a known
 * offset. An unrecognised flag becomes an error naming the command's help,
 * which is the only safe answer: the alternative is guessing that it was meant
 * as a value.
 *
 * `commands/cloud/index.ts` resolves its positionals against its own spec for
 * the same reason; this is that idea for the commands whose positionals are
 * credentials rather than resource names.
 */
import arg from "arg";

/**
 * Flags accepted on top of whatever a command declares.
 *
 * `--debug` is read by `bin/rebase.js` off `process.argv` and never by a
 * command, but it has to be *declared* somewhere or strict parsing rejects the
 * exact flag the CLI tells people to add. `--help`/`-h` are answered by each
 * command's dispatcher before any work happens.
 */
export const GLOBAL_COMMAND_FLAGS = {
    "--debug": Boolean,
    "--help": Boolean,
    "-h": "--help"
} as const;

export interface ParsedCommand<S extends arg.Spec> {
    /** The declared flags, as `arg` resolved them. */
    flags: arg.Result<S>;
    /** What is left after the command words — never a flag. */
    positionals: string[];
    /** `--help` or `-h` appeared anywhere on the line. */
    help: boolean;
}

/** Did the line ask for help? Answered before dispatch, never by a handler. */
export function wantsHelp(rawArgs: string[]): boolean {
    return rawArgs.includes("--help") || rawArgs.includes("-h");
}

/**
 * Resolve a command's flags and positionals from the full `process.argv`.
 *
 * `commandWords` is how many words name the command itself — 2 for
 * `auth reset-password`, 1 for `start` — and is applied to the *parsed*
 * positionals rather than to `argv`, so a flag placed before the command no
 * longer shifts them.
 *
 * `command` names the command in error messages, e.g. `auth reset-password`.
 *
 * Throws on an unknown flag, on a positional that looks like a flag, and on
 * more positionals than the command takes. `bin/rebase.js` turns each into a
 * one-line `✗ …` and exit 1.
 */
export function parseCommandArgs<S extends arg.Spec>({
    spec,
    rawArgs,
    commandWords,
    command,
    maxPositionals
}: {
    spec: S;
    rawArgs: string[];
    commandWords: number;
    command: string;
    maxPositionals?: number;
}): ParsedCommand<S> {
    let parsed: arg.Result<S> & { "--help"?: boolean };
    try {
        const merged = {
            ...GLOBAL_COMMAND_FLAGS,
            ...spec
        };
        parsed = arg(merged, { argv: rawArgs.slice(2) }) as arg.Result<S> & { "--help"?: boolean };
    } catch (err) {
        if (err instanceof Error && (err as arg.ArgError).code === "ARG_UNKNOWN_OPTION") {
            throw new Error(
                `${err.message} — run \`rebase ${command} --help\` for the options it takes.`
            );
        }
        throw err;
    }

    const positionals = parsed._.slice(commandWords);

    for (const value of positionals) {
        // Only reachable past a `--` separator or for a bare `-`, since anything
        // else beginning with `-` was either declared or already rejected above.
        // Still refused rather than accepted: a value that looks like a flag is
        // as likely to be a typo as an argument, and one of these positions is a
        // password.
        if (value.startsWith("-")) {
            throw new Error(
                `\`${value}\` looks like an option, not a value — pass it with an explicit flag ` +
                `(\`rebase ${command} --help\`).`
            );
        }
    }

    if (maxPositionals !== undefined && positionals.length > maxPositionals) {
        throw new Error(
            `rebase ${command} takes ${maxPositionals} argument${maxPositionals === 1 ? "" : "s"}, ` +
            `got ${positionals.length}: ${positionals.join(" ")}`
        );
    }

    return {
        flags: parsed,
        positionals,
        help: Boolean(parsed["--help"])
    };
}
