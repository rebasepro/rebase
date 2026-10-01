/**
 * Where a path typed on a `rebase` command line resolves: one rule, one sentence.
 *
 * The driver CLI runs with `cwd: backend/` — that is where it and its
 * dependencies resolve from — while people type commands from the project root
 * (or anywhere else in it). So every relative path on the line is resolved by
 * the CLI, from the directory the command was run in, before the driver is
 * handed a different one (`absolutizeLocalPathArgs` in `commands/db.ts`).
 * `generate-sdk` and `db backup --out` already worked that way; `--collections`
 * was resolved from `backend/` and was the odd one out.
 *
 * The sentence below is printed by every help page that takes `--collections`,
 * and by the refusal when the path is not there, so the rule is stated in one
 * set of words wherever a reader meets it.
 */
import fs from "fs";
import path from "path";
import chalk from "chalk";

/** The rule, as every help page and error states it. */
export const COLLECTIONS_PATH_RULE = "relative paths are resolved from where you run the command";

/** The `--collections` line of a help page. */
export const COLLECTIONS_FLAG_HELP = `Collections directory (default: config/collections); ${COLLECTIONS_PATH_RULE}`;

/** The flags that carry a collections path, in every spelling the driver accepts. */
const COLLECTIONS_FLAGS = ["--collections", "-c"];

/** The `--collections` value on a line, as typed, or `null` when there is none. */
function typedCollectionsPath(args: readonly string[]): string | null {
    for (let i = 0; i < args.length; i++) {
        const token = args[i];
        const eq = token.indexOf("=");
        if (eq > 0 && COLLECTIONS_FLAGS.includes(token.slice(0, eq))) return token.slice(eq + 1) || null;
        if (COLLECTIONS_FLAGS.includes(token)) {
            const value = args[i + 1];
            return value && !value.startsWith("-") ? value : null;
        }
    }
    return null;
}

/**
 * The refusal for a `--collections` path that does not exist, or `null`.
 *
 * Checked by the CLI, in the reader's terms, before the driver is spawned: the
 * driver's own check runs in `backend/` and can only describe the path it was
 * handed. A generator pointed at a directory that is not there writes an empty
 * schema, and a push of an empty schema drops every table — so nothing runs.
 *
 * Scripts written for the old rule (`--collections ../config/collections`,
 * run from the root) land here, and the message says exactly what to change.
 */
export function missingCollectionsPath(args: readonly string[], cwd: string, backendDir: string): string[] | null {
    const typed = typedCollectionsPath(args);
    if (typed === null) return null;
    const resolved = path.resolve(cwd, typed);
    if (fs.existsSync(resolved)) return null;

    const lines = [
        chalk.red(`✗ Collections path not found: "${typed}"`),
        chalk.gray(`    Resolved to: ${resolved}`),
        chalk.gray(`    (${COLLECTIONS_PATH_RULE}: ${cwd})`)
    ];
    const fromBackend = path.resolve(backendDir, typed);
    if (!path.isAbsolute(typed) && fs.existsSync(fromBackend)) {
        lines.push(
            "",
            chalk.yellow(`  From backend/ it would be ${fromBackend} — the driver used to resolve paths from there.`),
            chalk.yellow(`  Leave the flag out (config/collections is the default), or write it from here: ${path.relative(cwd, fromBackend) || "."}`)
        );
    }
    lines.push(
        "",
        chalk.gray("  Nothing was generated and nothing was applied — a schema generated from a"),
        chalk.gray("  directory that is not there is an empty one, and applying it would drop"),
        chalk.gray("  every table it does not describe.")
    );
    return lines;
}

/** Print {@link missingCollectionsPath}'s refusal and exit 1, or return. */
export function refuseMissingCollectionsPath(args: readonly string[], cwd: string, backendDir: string): void {
    const lines = missingCollectionsPath(args, cwd, backendDir);
    if (!lines) return;
    console.error("");
    for (const line of lines) console.error(line);
    console.error("");
    process.exit(1);
}
