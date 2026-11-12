/**
 * Where a path typed on a `rebase` command line resolves: one rule, one sentence.
 *
 * The driver CLI runs with `cwd: backend/` — that is where it and its
 * dependencies resolve from — while people type commands from the project root
 * (or anywhere else in it). So every relative path on the line is resolved by
 * the CLI, from the directory the command was run in, before the driver is
 * handed a different one (`absolutizeLocalPathArgs` in `commands/db.ts`).
 * `generate-sdk` and `db backup --out` already worked that way, and so does
 * `--schema-dir`.
 *
 * The sentence below is printed by every help page that takes `--schema-dir`,
 * and by the refusal when the path is not there, so the rule is stated in one
 * set of words wherever a reader meets it.
 */
import fs from "fs";
import path from "path";
import chalk from "chalk";
import { SCHEMA_DIR_FLAG } from "./schema-dir";

/** The rule, as every help page and error states it. */
export const PATH_RESOLUTION_RULE = "relative paths are resolved from where you run the command";

/** The `--schema-dir` line of a help page. */
export const SCHEMA_DIR_FLAG_HELP = "Schema directory — the one whose index.ts exports the tables " +
    `(default: backend/schema, or the backend's "tables" in rebase.json); ${PATH_RESOLUTION_RULE}`;

/** The `--schema-dir` value on a line, as typed, or `null` when there is none. */
function typedSchemaDir(args: readonly string[]): string | null {
    for (let i = 0; i < args.length; i++) {
        const token = args[i];
        const eq = token.indexOf("=");
        if (eq > 0 && token.slice(0, eq) === SCHEMA_DIR_FLAG) return token.slice(eq + 1) || null;
        if (token === SCHEMA_DIR_FLAG) {
            const value = args[i + 1];
            return value && !value.startsWith("-") ? value : null;
        }
    }
    return null;
}

/**
 * What a refusal over a missing `--schema-dir` path spared, by what the command
 * would have done with it. Only a schema writer drops tables; a console or a
 * doctor run over nothing does something else wrong, and says so.
 */
const MISSING_SCHEMA_DIR_CONSEQUENCE = {
    schema: [
        "Nothing was generated and nothing was applied — a schema generated from a",
        "directory that is not there is an empty one, and applying it would drop",
        "every table it does not describe."
    ],
    console: [
        "Nothing was started — a console over a directory that is not there would",
        "load none of this project's tables."
    ],
    doctor: [
        "Nothing was checked — a directory that is not there declares no tables, so",
        "every table check would pass over it."
    ],
    verify: [
        "Nothing was verified — a directory that is not there declares no tables, so",
        "every step would pass over it and report 0 errors."
    ]
} as const;

/** What a command does with its `--schema-dir` path. */
export type SchemaDirUse = keyof typeof MISSING_SCHEMA_DIR_CONSEQUENCE;

/**
 * The refusal for a `--schema-dir` path that does not exist, or `null`.
 *
 * Checked by the CLI, in the reader's terms, before the driver is spawned: the
 * driver's own check runs in `backend/` and can only describe the path it was
 * handed. A generator pointed at a directory that is not there writes an empty
 * schema, and a push of an empty schema drops every table — so nothing runs.
 *
 * A path written from `backend/` (`--schema-dir schema`, run from the root)
 * lands here, and the message says exactly what to change.
 */
export function missingSchemaDir(
    args: readonly string[],
    cwd: string,
    backendDir: string,
    use: SchemaDirUse = "schema"
): string[] | null {
    const typed = typedSchemaDir(args);
    if (typed === null) return null;
    const resolved = path.resolve(cwd, typed);
    if (fs.existsSync(resolved)) return null;

    const lines = [
        chalk.red(`✗ Schema directory not found: "${typed}"`),
        chalk.gray(`    Resolved to: ${resolved}`),
        chalk.gray(`    (${PATH_RESOLUTION_RULE}: ${cwd})`)
    ];
    const fromBackend = path.resolve(backendDir, typed);
    if (!path.isAbsolute(typed) && fs.existsSync(fromBackend)) {
        lines.push(
            "",
            chalk.yellow(`  From backend/ it would be ${fromBackend} — the driver runs from there, but the CLI resolves from here.`),
            chalk.yellow(`  Leave the flag out (backend/schema is the default), or write it from here: ${path.relative(cwd, fromBackend) || "."}`)
        );
    }
    lines.push("", ...MISSING_SCHEMA_DIR_CONSEQUENCE[use].map(line => chalk.gray(`  ${line}`)));
    return lines;
}

/** Print {@link missingSchemaDir}'s refusal and exit 1, or return. */
export function refuseMissingSchemaDir(
    args: readonly string[],
    cwd: string,
    backendDir: string,
    use: SchemaDirUse = "schema"
): void {
    const lines = missingSchemaDir(args, cwd, backendDir, use);
    if (!lines) return;
    console.error("");
    for (const line of lines) console.error(line);
    console.error("");
    process.exit(1);
}
