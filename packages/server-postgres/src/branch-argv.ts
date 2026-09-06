/**
 * Argument shapes for `rebase db branch`, with no dependencies.
 *
 * Its own module for the same reason `schema/atlas-argv.ts` is: `cli.ts` pulls
 * in chalk, execa and the driver runtime, so a unit test that imports it cannot
 * run. Argv parsing is the part most worth testing and the part least in need
 * of any of that.
 */

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
 * Anything starting with `-` is left alone rather than validated. This runs on
 * every branch subcommand, including ones added later with flags this function
 * has never heard of, and rejecting an unrecognised flag here would break them
 * from a distance. The value after a flag that takes one is skipped for the
 * same reason: it is that flag's argument, not a stray word.
 *
 * @param words The command's own arguments: action, name, then the rest.
 */
export function unexpectedBranchArgs(words: readonly string[]): string[] {
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
