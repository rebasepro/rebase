/**
 * Argument shapes for `rebase db branch`, with no runtime dependencies.
 *
 * Its own module for the same reason `schema/atlas-argv.ts` is: `cli.ts` pulls
 * in chalk, execa and the driver runtime, so a unit test that imports it cannot
 * run. Argv parsing is the part most worth testing and the part least in need
 * of any of that.
 */
import arg from "arg";
import { suggestNearMiss } from "@rebasepro/utils";

import { RELAYED_FLAGS } from "./cli-flags";

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
    // `delete` does not ask, but `--yes` is what a script passes to every
    // destructive command; refusing it would break that line for nothing.
    delete: { "--force": Boolean, "--yes": Boolean, "-y": "--yes" },
    prune: { "--older-than": String, "--include-dev-diff": Boolean, "--yes": Boolean, "-y": "--yes" }
};

/**
 * `--froce` for `--force`: two neighbouring letters swapped, which
 * `suggestNearMiss` counts as two edits and so never offers.
 */
function transposedFrom(known: readonly string[], typed: string): string | undefined {
    return known.find((candidate) => {
        if (candidate.length !== typed.length || candidate === typed) return false;
        const differ = [...candidate].flatMap((letter, index) => (letter === typed[index] ? [] : [index]));
        return differ.length === 2 && differ[1] === differ[0] + 1
            && candidate[differ[0]] === typed[differ[1]] && candidate[differ[1]] === typed[differ[0]];
    });
}

/**
 * Refuse a flag `action` does not take, naming the one it was probably meant
 * to be — the same sentence `db backup` and `db restore` say.
 *
 * Throws: the driver's entry turns a thrown error into one red line and exit 1,
 * and this runs before anything connects.
 */
function assertKnownBranchFlags(action: string, rest: readonly string[]): void {
    const spec = BRANCH_ACTION_FLAGS[action];
    if (!spec) return;

    const full = { ...RELAYED_FLAGS, ...spec };
    try {
        arg(full, { argv: [...rest] });
    } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ARG_UNKNOWN_OPTION") throw error;
        // arg's wording: `unknown or unexpected option: --froce`.
        const unknown = /option: (\S+)$/.exec(error.message)?.[1] ?? error.message;
        const typed = unknown.split("=")[0];
        const known = Object.keys(full).filter((flag) => flag.startsWith("--"));
        const suggestion = suggestNearMiss(known, typed) ?? transposedFrom(known, typed);
        const own = Object.keys(spec).filter((flag) => flag.startsWith("--"));
        const takes = own.length > 0 ? `it takes ${own.join(", ")}` : "it takes no options of its own";
        throw new Error(
            `\`rebase db branch ${action}\` has no option ${typed}` +
            (suggestion ? ` — did you mean ${suggestion}?` : ` — ${takes}.`) +
            " Nothing was run. See `rebase db branch --help`."
        );
    }
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

    const extras: string[] = [];

    // 0 is the action ("create"); the first bare word after it is the name.
    //
    // Found by scanning rather than by position, which is the fix: `["list",
    // "--database-url", "postgres://…"]` put a flag in slot 1, so the scan
    // started past it and read the URL as a stray word.
    let seenName = false;
    for (let index = 1; index < words.length; index += 1) {
        const word = words[index];
        if (word.startsWith("-")) {
            if (TAKES_A_VALUE.has(word.split("=")[0])) index += 1;
            continue;
        }
        if (!seenName) {
            seenName = true;
            continue;
        }
        extras.push(word);
    }

    return extras;
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
const TAKES_A_VALUE = new Set(["--from", "--older-than", "--database-url"]);
