/**
 * Argument shapes for `rebase db branch`, with no runtime dependencies.
 *
 * Its own module for the same reason `schema/atlas-argv.ts` is: `cli.ts` pulls
 * in chalk, execa and the driver runtime, so a unit test that imports it cannot
 * run. Argv parsing is the part most worth testing and the part least in need
 * of any of that.
 */
import arg from "arg";

import { RELAYED_FLAGS, resolveSwitchValues, unknownFlagIn, unknownOptionSentence } from "./cli-flags";

/**
 * The flags each driver-side `db branch` action takes, besides the ones the CLI
 * relays on every line (`--database-url`, `--docker`, `--debug`).
 *
 * `switch` is absent: the CLI answers it before the driver is ever spawned.
 * An action not listed here is not checked, so the dispatch can say it does
 * not exist in its own words.
 */
export const BRANCH_ACTION_FLAGS: Record<string, arg.Spec> = {
    create: { "--from": String, "--force": Boolean },
    list: {},
    info: {},
    diff: { "--json": Boolean, "--sample-limit": Number },
    // `delete` does not ask, but `--yes` is what a script passes to every
    // destructive command; refusing it would break that line for nothing.
    delete: { "--force": Boolean, "--yes": Boolean, "-y": "--yes" },
    prune: { "--older-than": String, "--include-dev-diff": Boolean, "--yes": Boolean, "-y": "--yes" }
};

/**
 * Refuse a flag `action` does not take, naming the one it was probably meant
 * to be — the same sentence `db backup` and `db restore` say.
 *
 * Throws: the driver's entry turns a thrown error into one red line and exit 1,
 * and this runs before anything connects.
 */
export function assertKnownBranchFlags(action: string, rest: readonly string[]): void {
    const spec = BRANCH_ACTION_FLAGS[action];
    if (!spec) return;

    const full = { ...RELAYED_FLAGS, ...spec };
    const argv = resolveSwitchValues(full, rest, `db branch ${action}`, "db branch");
    try {
        arg(full, { argv });
    } catch (error) {
        const unknown = unknownFlagIn(error, rest);
        if (unknown === null) throw error;
        throw new Error(unknownOptionSentence(`db branch ${action}`, "db branch", unknown, spec));
    }
}

/**
 * A `db branch` line, `["db", "branch", <action>, …]`, with its switches'
 * values resolved against the action's flags (see `resolveSwitchValues`):
 * what the branch dispatch reads, so `prune --yes=false` is not a yes. An
 * action the table does not list comes back as it was.
 */
export function resolveBranchSwitches(rawArgs: readonly string[]): string[] {
    const action = rawArgs[2];
    const spec = action === undefined ? undefined : BRANCH_ACTION_FLAGS[action];
    if (!spec) return [...rawArgs];
    return [...rawArgs.slice(0, 3), ...resolveSwitchValues({ ...RELAYED_FLAGS, ...spec }, rawArgs.slice(3), `db branch ${action}`, "db branch")];
}

/**
 * Words on a `db branch` command line that no argument accounts for.
 *
 * `rebase db branch create alpha beta` created a branch called `alpha` and
 * threw `beta` away without a word. The shapes that produces are all quiet and
 * all wrong: an unquoted name (`create my feature` → `my`), a flag written
 * without its dashes (`create feat from main` → `feat`), a shell that split
 * something you thought was one token. In each case the command succeeds and
 * the branch is not the one asked for — and branch names are the thing you
 * later type to switch, delete, or point a deploy at.
 *
 * A flag the action does not take is refused outright, by throwing — see
 * {@link BRANCH_ACTION_FLAGS}. It was let through on the reasoning that a
 * subcommand added later might take flags this file had never heard of; what
 * that bought was every typo running without the flag it meant:
 * `prune --older-then 1d --yes` pruned by no age, `create x --froce` ran
 * without --force. A new action gets its line in the table. The value after a
 * flag that takes one is skipped: it is that flag's argument, not a stray word.
 *
 * @param words The command's own arguments: action, name, then the rest.
 */
export function unexpectedBranchArgs(words: readonly string[]): string[] {
    if (words[0]) assertKnownBranchFlags(words[0], words.slice(1));
    return readBranchWords(words).extras;
}

/**
 * The branch a `db branch` line names: the first bare word after the action,
 * wherever the flags sit.
 *
 * Not the word in slot 1: in `create --force feat` that is `--force`, which
 * is a legal branch name (hyphens are allowed), so a positional read creates a
 * branch called `--force` and never creates `feat`.
 *
 * @param words The command's own arguments: action, name, then the rest.
 */
export function branchNameIn(words: readonly string[]): string | undefined {
    return readBranchWords(words).name;
}

/**
 * The source `branch create --from <source>` (or `--from=<source>`) names, if
 * it names one. Both spellings are read: `unexpectedBranchArgs` accepts the
 * `=` form, and a lookup of the bare `--from` word misses it and copies the
 * main database instead of the source asked for.
 *
 * @param words The command's own arguments: action, name, then the rest.
 */
export function branchSourceIn(words: readonly string[]): string | undefined {
    return readBranchWords(words).from || undefined;
}

/**
 * One left-to-right reading of a `db branch` line: the name, `--from`'s value,
 * and every bare word past the name.
 *
 * 0 is the action ("create"); the first bare word after it is the name, found
 * by scanning rather than by position: in `["list", "--database-url",
 * "postgres://…"]` slot 1 holds a flag, and its URL is no stray word. The word after a flag that takes a value is that flag's
 * argument, not a stray word; a `--flag=value` carries its value in the same
 * word, so the word after it is read as what it is.
 */
function readBranchWords(words: readonly string[]): { name: string | undefined; from: string | undefined; extras: string[] } {
    let name: string | undefined;
    let from: string | undefined;
    const extras: string[] = [];
    for (let index = 1; index < words.length; index += 1) {
        const word = words[index];
        if (word.startsWith("-")) {
            const equals = word.indexOf("=");
            const flag = equals === -1 ? word : word.slice(0, equals);
            const value = equals === -1 ? words[index + 1] : word.slice(equals + 1);
            if (equals === -1 && TAKES_A_VALUE.has(flag)) index += 1;
            if (flag === "--from") from = value;
            continue;
        }
        if (name === undefined) name = word;
        else extras.push(word);
    }
    return { name, from, extras };
}

/**
 * Branch-line flags whose next word belongs to them.
 *
 * `--from` was the only one listed, and `--database-url` is the one that bit:
 * `rebase db branch list --database-url postgres://…` — which the CLI itself
 * appends when the checkout is on a branch, so `rebase.branches` is read in the
 * parent where it lives — answered `✗ Unexpected argument: postgres://…`. The
 * `=` form carries its value in the same word and needs no skip.
 */
const TAKES_A_VALUE = new Set(["--from", "--older-than", "--sample-limit", "--database-url"]);
