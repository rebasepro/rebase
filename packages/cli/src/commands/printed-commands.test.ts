/**
 * Every `rebase …` the CLI prints at a user is a command the CLI runs.
 *
 * `rebase link <url>` was printed by three of them — `rebase apps config
 * backend` on an unlinked checkout, and `generate-sdk` on both of its "this is
 * not linked" paths — and there has never been a top-level `link` command. The
 * link lives in the cloud family, so the correct line is `rebase cloud link`.
 * Each of those three is the last line of a message whose entire job is to say
 * what to run next, so the one place the CLI is asked "what now?" answered with
 * something that exits 1.
 *
 * `check-doc-commands.mjs` already holds the markdown to the CLI's real surface.
 * This is the same check for the strings the CLI itself emits, which that
 * verifier never looks at — and which are read far more often, because they
 * arrive exactly when somebody is stuck.
 *
 * Only the FIRST word is checked. Whether `cloud env pull` is a real action is
 * `cloud-help.test.ts`'s question and `action-help.test.ts`'s; this one is about
 * the word `cli.ts` dispatches on.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "..");

/** The top-level words `cli.ts` dispatches, read from the declaration itself. */
function dispatchedCommands(): Set<string> {
    const source = fs.readFileSync(path.join(SRC, "cli.ts"), "utf8");
    const declared = /const namespacedCommands = \[([^\]]*)\]/.exec(source);
    if (!declared) throw new Error("namespacedCommands not found in cli.ts — this check is reading the wrong thing");
    const words = new Set([...declared[1].matchAll(/"([a-z][a-z0-9-]*)"/g)].map(m => m[1]));
    // Dispatched by a `case` rather than listed, because they take no
    // subcommand and so never need the `--help` special-casing the list drives.
    for (const extra of ["init", "dev", "build", "start", "doctor", "eject", "generate-sdk"]) words.add(extra);
    return words;
}

/** Every `.ts` file under `src/`, tests excluded. */
function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...sourceFiles(full));
        else if (entry.name.endsWith(".ts") && !entry.name.includes(".test.")) out.push(full);
    }
    return out;
}

/**
 * `rebase <word>` where the CLI is quoting a command at a reader.
 *
 * The opening delimiter is required, and it is what separates a command from
 * prose about one: this repo writes a command as `` `rebase db push` `` or as
 * `chalk.cyan("rebase cloud link")`, so a match must start right after a
 * backtick or a quote. Without that rule the sweep also catches "Every rebase
 * command in this checkout now uses it" and `raw.rebase as string` — two lines
 * that are correct, which is the kind of finding that gets a check deleted
 * rather than fixed.
 *
 * Comment lines are skipped for the same reason: a docblock explaining that
 * `rebase link` never existed has to be able to write the words down, and this
 * file is the proof that it does.
 */
function printedCommands(source: string): Array<{ word: string; line: number }> {
    const found: Array<{ word: string; line: number }> = [];
    const lines = source.split("\n");
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed.startsWith("*") || trimmed.startsWith("//")) continue;
        for (const match of line.matchAll(/[`"']rebase ([a-z][a-z0-9-]*)/g)) {
            found.push({ word: match[1],
line: i + 1 });
        }
    }
    return found;
}

describe("commands the CLI prints", () => {
    const commands = dispatchedCommands();

    it("reads the dispatch list, so an empty sweep cannot pass", () => {
        expect(commands.size).toBeGreaterThan(10);
        expect(commands.has("cloud")).toBe(true);
        // The word this check exists for. If a top-level `link` is ever added,
        // this line is where the check gets relaxed on purpose.
        expect(commands.has("link")).toBe(false);
    });

    it("finds the lines it is checking, so an empty sweep cannot pass", () => {
        // A quoting convention that changed would otherwise make this vacuous
        // and silent — the failure mode of every source-derived check.
        const total = sourceFiles(SRC)
            .reduce((n, file) => n + printedCommands(fs.readFileSync(file, "utf8")).length, 0);
        expect(total).toBeGreaterThan(40);
    });

    it("names only commands `cli.ts` dispatches", () => {
        const offenders: string[] = [];
        for (const file of sourceFiles(SRC)) {
            const source = fs.readFileSync(file, "utf8");
            for (const { word, line } of printedCommands(source)) {
                if (!commands.has(word)) offenders.push(`${path.relative(SRC, file)}:${line} → rebase ${word}`);
            }
        }
        expect(
            offenders,
            "these lines tell a user to run something the CLI does not dispatch, and they are "
            + "printed at the moment somebody is stuck"
        ).toEqual([]);
    });
});
