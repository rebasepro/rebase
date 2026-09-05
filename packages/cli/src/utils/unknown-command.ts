/**
 * What every command family says when it does not recognise a subcommand.
 *
 * Six families each did it differently, and the differences were not stylistic:
 *
 *   rebase statsu       "Unknown command: statsu" + the whole top-level help
 *   rebase auth foo     "Unknown auth command: foo" + the whole auth help
 *   rebase apps foo     "Unknown subcommand: foo"   — which command's?
 *   rebase skills foo   "Unknown skills subcommand: foo" + the whole help
 *   rebase telemetry x  the help, silently, with exit code 1 and no error line
 *   rebase cloud debug x both a JSON error *and* the human one, in JSON mode
 *
 * Dumping a screen of help after an error is the wrong shape: the one line that
 * says what happened scrolls off the top, and in a CI log it is buried in
 * forty. None of them offered the correction, which for a typo is the entire
 * answer — `statsu` is one transposition from `status`.
 *
 * So: one line, the near-miss when there is one, and where to read the rest.
 */
import chalk from "chalk";

/**
 * Damerau–Levenshtein distance, capped by the caller.
 *
 * The transposition is the reason this is not plain Levenshtein: `statsu` for
 * `status` and `craete` for `create` are the two most common typing errors
 * there are, and both are distance 2 without it — the same as two unrelated
 * edits, which is too far to suggest anything at all.
 */
function editDistance(a: string, b: string): number {
    const rows = a.length + 1;
    const cols = b.length + 1;
    const d: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

    for (let i = 0; i < rows; i++) d[i][0] = i;
    for (let j = 0; j < cols; j++) d[0][j] = j;

    for (let i = 1; i < rows; i++) {
        for (let j = 1; j < cols; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(
                d[i - 1][j] + 1,
                d[i][j - 1] + 1,
                d[i - 1][j - 1] + cost
            );
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
            }
        }
    }
    return d[a.length][b.length];
}

/**
 * The one command the user probably meant, or nothing.
 *
 * Tight on purpose. A suggestion that is wrong is worse than none: it sends
 * someone to read the help for a command that was never the answer, and on a
 * family like `db` — where `push` and `pull` are one edit apart — a loose
 * threshold would confidently propose the destructive neighbour of what they
 * typed. So: one edit for a short word, two for a long one, and a prefix match
 * always counts (`rebase cloud dep` for `deploy`).
 */
export function suggestCommand(typed: string, known: readonly string[]): string | undefined {
    const word = typed.toLowerCase();
    if (!word) return undefined;

    // An abbreviation, but only when it names exactly one command. "res" is a
    // prefix of both `reset` and `restore`, and picking whichever comes first
    // in the list would be a coin toss dressed up as an answer.
    if (word.length >= 3) {
        const prefixed = known.filter(name => name.toLowerCase().startsWith(word));
        if (prefixed.length === 1) return prefixed[0];
    }

    const budget = word.length <= 4 ? 1 : 2;
    let best: { name: string; distance: number } | undefined;

    for (const candidate of known) {
        const distance = editDistance(word, candidate.toLowerCase());
        if (distance > budget) continue;
        if (!best || distance < best.distance) best = { name: candidate, distance };
    }

    return best?.name;
}

/**
 * The line itself, without printing it — so callers that must answer in JSON
 * (the cloud family, whose `fail()` writes a machine-readable envelope) use the
 * same words as the ones that print.
 *
 * `family` is empty for the top level: `rebase --help`, not `rebase  --help`.
 */
export function unknownCommandMessage(
    typed: string | undefined,
    known: readonly string[],
    family = ""
): string {
    const what = family ? `${family} command` : "command";
    const suggestion = typed ? suggestCommand(typed, known) : undefined;
    const help = family ? `rebase ${family} --help` : "rebase --help";

    return suggestion
        ? `Unknown ${what} "${typed}" — did you mean \`${suggestion}\`? Run \`${help}\` for the rest.`
        : `Unknown ${what} "${typed ?? ""}". Run \`${help}\` for the ones there are.`;
}

/**
 * Print the line to stderr and exit 1.
 *
 * stderr, not stdout: a mistyped command is a failure, and the families with a
 * `--json` mode guarantee that stdout holds only their envelope.
 */
export function unknownCommand(
    typed: string | undefined,
    known: readonly string[],
    family = ""
): never {
    console.error(chalk.red(`✗ ${unknownCommandMessage(typed, known, family)}`));
    process.exit(1);
}
