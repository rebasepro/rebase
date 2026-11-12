/**
 * `--schema-dir <dir>`, checked once, before anything is written.
 *
 * A directory that does not resolve must stop the command before either
 * generator runs. The previous flag (`--collections`) once warned and carried
 * on, four times over — `schemaCommand`, `generatePostgresDdlCommand` and the
 * Atlas argv assembly each re-enter the loader with the same line — and then
 * both generators wrote an *empty* schema: `drizzle/schema.sql` truncated to
 * `CREATE SCHEMA IF NOT EXISTS "rebase";`, `src/schema.generated.ts` to ten
 * lines. Both were committed artifacts then. The push that followed planned a
 * `DROP TABLE` for every table in the database, and the only thing between a
 * typo and that was the destructive gate.
 *
 * The loader itself (`loadTables`) answers a directory that is not there with
 * "no tables" — the headless layout, where the runtime introspects the
 * database. That is the right answer for the *default* directory and the wrong
 * one for a directory somebody typed, so the typed one is checked here.
 */
import fs from "fs";
import path from "path";
import chalk from "chalk";
import { LEGACY_LAYOUT_REMEDY } from "@rebasepro/types";
import { outError } from "./cli-output";

/**
 * The schema directory the driver reads when the command line names none:
 * `schema`, relative to the driver's working directory — which is `backend/`,
 * so `backend/schema`. The CLI passes `--schema-dir <absolute dir>` only when a
 * project keeps its tables elsewhere (`rebase.json` `apps.<backend>.tables`).
 */
export const DEFAULT_SCHEMA_DIR = "schema";

/**
 * Thrown rather than exited, so the tests can see it and the entry point owns
 * the exit code.
 *
 * `alreadyReported` is read by `reportCommandFailure`: the full diagnosis is on
 * stderr by the time this is thrown, and it is printed once.
 */
export class SchemaDirMissing extends Error {
    readonly alreadyReported = true;

    constructor(readonly typed: string, readonly resolved: string) {
        super(`Schema directory not found: "${typed}"`);
        this.name = "SchemaDirMissing";
    }
}

/**
 * The whole message, in one place, because it is printed by two callers.
 *
 * Names what was typed, what it resolved to, and the working directory it
 * resolved against — a relative `--schema-dir` is resolved against the cwd,
 * and the driver runs with `cwd: backend/`, so "the path is right and the
 * directory is wrong" is the commonest way to arrive here.
 */
export function describeMissingSchemaDir(typed: string, resolved: string): string {
    return [
        chalk.red(`✗ Schema directory not found: "${typed}"`),
        chalk.gray(`    Resolved to: ${resolved}`),
        chalk.gray(`    (relative to cwd: ${process.cwd()})`),
        "",
        chalk.gray("  Nothing was generated and nothing was applied — a schema generated from a"),
        chalk.gray("  directory that is not there is an empty one, and applying it would drop"),
        chalk.gray("  every table it does not describe."),
        "",
        chalk.gray("  Pass the directory whose index.ts exports your tables (backend/schema), as an"),
        chalk.gray("  absolute path or one relative to where you run the command.")
    ].join("\n");
}

/**
 * Refuse a `--schema-dir` that does not exist.
 *
 * `null` means the flag was not given: the default (`schema`, relative to
 * `backend/`) is left to the loader, which reads a missing directory as "no
 * tables declared" — a headless project legitimately has none.
 */
export function assertSchemaDirExists(typed: string | null): void {
    if (typed === null) return;

    const resolved = path.resolve(process.cwd(), typed);
    if (fs.existsSync(resolved)) return;

    outError("");
    outError(describeMissingSchemaDir(typed, resolved));
    outError("");
    throw new SchemaDirMissing(typed, resolved);
}

/**
 * The driver commands that read the schema directory — the ones `--schema-dir`
 * belongs to, and the ones that used to take `--collections`. Keyed as the
 * driver's argv starts: domain, then subcommand (or the bare domain for the
 * single-word commands). Mirrors the CLI's own list (`packages/cli`
 * `schema-dir.ts`), which decides when to pass the flag.
 */
export const COMMANDS_READING_SCHEMA = new Set([
    "db push",
    "db generate",
    "schema generate",
    "schema stale",
    "doctor",
    "console"
]);

/** Whether `args` (the driver's whole line) is a command that reads the schema directory. */
export function readsSchemaDir(args: readonly string[]): boolean {
    return COMMANDS_READING_SCHEMA.has(args[0] ?? "") || COMMANDS_READING_SCHEMA.has(`${args[0]} ${args[1]}`);
}

/**
 * The one line a removed `--collections` (or `-c`) flag is refused with.
 *
 * The flag named a `config/collections` directory of `defineCollection`
 * files, which nothing reads any more: tables live in `backend/schema`, the
 * driver reads it by default, and `--schema-dir` names another directory.
 * Refused rather than ignored — silently reading the default directory
 * instead of the one typed would generate (and push) a different schema.
 */
export function removedCollectionsFlagSentence(args: readonly string[]): string | null {
    if (!readsSchemaDir(args)) return null;
    const words = args.slice(1);
    const end = words.indexOf("--");
    const flags = end === -1 ? words : words.slice(0, end);
    const used = flags.find(word => word === "--collections" || word.startsWith("--collections=") || word === "-c");
    if (used === undefined) return null;
    const flag = used.startsWith("--collections") ? "--collections" : "-c";
    return `${flag} was removed: tables are read from backend/schema (\`defineTable\`), by default, ` +
        "and `--schema-dir <dir>` names another directory. Nothing was run. A project still on " +
        `config/collections: ${LEGACY_LAYOUT_REMEDY}.`;
}

/**
 * Refuse a line that still passes `--collections`. Throws rather than exits,
 * like {@link assertSchemaDirExists}.
 */
export function assertNoCollectionsFlag(args: readonly string[]): void {
    const sentence = removedCollectionsFlagSentence(args);
    if (sentence !== null) throw new Error(sentence);
}
