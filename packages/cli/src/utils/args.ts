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

import { redactConnectionPasswords } from "./redact";
import { suggestCommand } from "./unknown-command";

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

/**
 * The declared long flag an undeclared one was probably meant to be: one edit
 * or one swap away (`--form` → `--from`), or an abbreviation of exactly one
 * (`--anon` → `--anonymize`).
 */
function closestDeclaredFlag(typed: string, declared: readonly string[]): string | undefined {
    if (!typed.startsWith("--")) return undefined;
    const near = suggestCommand(typed.slice(2), declared.filter(flag => flag.startsWith("--")).map(flag => flag.slice(2)));
    return near ? `--${near}` : undefined;
}

/** Past this many, a refusal names the help page rather than listing every flag. */
const LISTED_FLAGS_MAX = 8;

/**
 * The sentence an undeclared flag is refused with — the one `db backup`,
 * `db restore` and `db branch` say, so one CLI answers a typo one way:
 *
 *     `rebase db pull` has no option --anonymise — did you mean --anonymize?
 *     Nothing was run. See `rebase db pull --help`.
 *
 * With nothing close it lists what the command takes, when that list is short
 * enough to read.
 *
 * `typed` is the argument as `arg` refused it, and only its flag part is
 * repeated: a value given inline (`--fro=postgres://u:pw@h/db`) is not. One
 * argument holding a flag and its value, quoted together, is named as that,
 * and what it quotes is password-masked: `"--fro postgres://u:pw@h/db"` was
 * refused with the whole URL, password included, in the middle of a garbled
 * sentence.
 *
 * Exported for the commands that refuse a flag outside `parseCommandArgs`.
 */
export function unknownOptionMessage(command: string, typed: string, spec: Readonly<Record<string, unknown>>): string {
    const declared = Object.keys({ ...GLOBAL_COMMAND_FLAGS, ...spec });
    const name = typed.split(/[=\s]/)[0];
    const near = closestDeclaredFlag(name, declared);
    const tail = ` Nothing was run. See \`rebase ${command} --help\`.`;

    if (/\s/.test(typed.trim())) {
        const flag = declared.includes(name) ? name : near;
        const how = flag
            ? ` Write them as two arguments, ${flag} <value>, or as ${flag}=<value>.`
            : " Write a flag and its value as two arguments.";
        return `\`rebase ${command}\` has no option "${redactConnectionPasswords(typed)}": ` +
            `that is a flag and a value in one argument, quoted together.${how}${tail}`;
    }

    const own = Object.keys(spec).filter(flag => flag.startsWith("--") && !(flag in GLOBAL_COMMAND_FLAGS));
    const takes = near
        ? ` — did you mean ${near}?`
        : own.length === 0
            ? " — it takes no options."
            : own.length <= LISTED_FLAGS_MAX ? ` — it takes ${own.join(", ")}.` : ".";

    return `\`rebase ${command}\` has no option ${name}${takes}${tail}`;
}

/** What a flag resolves to, through its alias (`"-y": "--yes"`). */
function handlerOf(spec: Readonly<Record<string, unknown>>, flag: string): unknown {
    const declared = spec[flag];
    return typeof declared === "string" ? spec[declared] : declared;
}

/** A flag that takes no value: on when given, off when left out. */
function isSwitch(handler: unknown): boolean {
    return handler === Boolean || (Array.isArray(handler) && handler[0] === Boolean);
}

/**
 * The first `--switch=value` on a line, if there is one.
 *
 * `arg` drops the value of a flag that takes none and turns the flag on, so
 * `--anonymize=false` anonymized and `--yes=false` answered yes. A value there
 * is the reader saying which way the switch goes, and there is no reading of
 * `=false` as "on" that is not a surprise. Past `--` every word is a
 * positional, so the scan stops there.
 */
export function switchGivenAValue(
    spec: Readonly<Record<string, unknown>>,
    argv: readonly string[]
): { flag: string; typed: string } | null {
    for (const word of argv) {
        if (word === "--") return null;
        if (!word.startsWith("--") || !word.includes("=")) continue;
        const flag = word.slice(0, word.indexOf("="));
        if (isSwitch(handlerOf(spec, flag))) return { flag, typed: word };
    }
    return null;
}

/** The sentence a switch given a value is refused with. */
export function switchValueMessage(command: string, flag: string, typed: string): string {
    return `\`rebase ${command}\` takes ${flag} without a value (${redactConnectionPasswords(typed)}): ` +
        `give it to turn it on, and leave it out to turn it off. Nothing was run. See \`rebase ${command} --help\`.`;
}

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
 * The command line was wrong — nothing ran, and there is no stack to want.
 *
 * `bin/rebase.js` ends every failure with "Re-run with --debug for the stack
 * trace.", which is right when something broke inside a command and absurd for
 * a typo: the stack points at `arg` and this file, neither of which the person
 * who mistyped `--ouput` has any interest in. Worse, `--debug` is a flag, so
 * the suggested next command is *another* command line — and the one thing we
 * have just established is that the command line is what went wrong.
 *
 * Marked with a property rather than left to `instanceof`, because the reader
 * is `bin/rebase.js`: it imports the bundle, so the class object it would test
 * against is not the one this file compiled to.
 */
export class UsageError extends Error {
    readonly isUsageError = true;

    constructor(message: string) {
        super(message);
        this.name = "UsageError";
    }
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
 * Throws on an unknown flag, on a switch given a value (`--yes=false`), on a
 * positional that looks like a flag, and on more positionals than the command
 * takes. `bin/rebase.js` turns each into a one-line `✗ …` and exit 1.
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
    const merged = {
        ...GLOBAL_COMMAND_FLAGS,
        ...spec
    };
    const switchValue = switchGivenAValue(merged, rawArgs.slice(2));
    if (switchValue) throw new UsageError(switchValueMessage(command, switchValue.flag, switchValue.typed));
    try {
        parsed = arg(merged, { argv: rawArgs.slice(2) }) as arg.Result<S> & { "--help"?: boolean };
    } catch (err) {
        if (err instanceof Error && (err as arg.ArgError).code === "ARG_UNKNOWN_OPTION") {
            // arg's wording: `unknown or unexpected option: --form`, naming
            // the argument up to its first `=`, past a space in it too. The
            // word it came from is what was typed.
            const named = /option: ([\s\S]+)$/.exec(err.message)?.[1] ?? "";
            const typed = rawArgs.slice(2).find(word => word === named || word.startsWith(`${named}=`)) ?? named;
            throw new UsageError(unknownOptionMessage(command, typed, spec));
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
            throw new UsageError(
                `\`${redactConnectionPasswords(value)}\` looks like an option, not a value — pass it with an explicit flag ` +
                `(\`rebase ${command} --help\`).`
            );
        }
    }

    if (maxPositionals !== undefined && positionals.length > maxPositionals) {
        // Redacted: a connection string passed where a flag's value belongs
        // (`rebase db pull "$PROD"`) is still a password.
        throw new UsageError(
            `rebase ${command} takes ${maxPositionals} argument${maxPositionals === 1 ? "" : "s"}, ` +
            `got ${positionals.length}: ${redactConnectionPasswords(positionals.join(" "))}`
        );
    }

    return {
        flags: parsed,
        positionals,
        help: Boolean(parsed["--help"])
    };
}
