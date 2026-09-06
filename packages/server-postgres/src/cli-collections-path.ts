/**
 * `--collections <dir>`, checked once, before anything is written.
 *
 * A path that does not resolve used to warn and carry on. Four times over —
 * `schemaCommand`, `generatePostgresDdlCommand` and the Atlas argv assembly
 * each re-enter the loader with the same line — and then both generators wrote
 * an *empty* schema: `drizzle/schema.sql` truncated to `CREATE SCHEMA IF NOT
 * EXISTS "rebase";`, `src/schema.generated.ts` to ten lines. Both are committed
 * artifacts. The push that followed planned a `DROP TABLE` for every table in
 * the database, and the only thing between a typo and that was the destructive
 * gate.
 *
 * The check has to be here rather than inside `loadCollectionsForCli`, which is
 * deliberately forgiving: its callers use it to narrow what Atlas may touch,
 * and making a broken *file* fatal there would block a push over something
 * unrelated. "Does the directory the user named exist" is a different question,
 * it was answerable before the first write, and the code already knew.
 */
import fs from "fs";
import path from "path";
import chalk from "chalk";
import { outError } from "./cli-output";

/**
 * Thrown rather than exited, so the tests can see it and the entry point owns
 * the exit code.
 *
 * `alreadyReported` is read by `reportCommandFailure`: the full diagnosis is on
 * stderr by the time this is thrown, and the point of the whole change is that
 * it is printed once.
 */
export class CollectionsPathMissing extends Error {
    readonly alreadyReported = true;

    constructor(readonly typed: string, readonly resolved: string) {
        super(`Collections path not found: "${typed}"`);
        this.name = "CollectionsPathMissing";
    }
}

/**
 * The whole message, in one place, because it is printed by two callers.
 *
 * Names what was typed, what it resolved to, and the working directory it
 * resolved against — a relative `--collections` is resolved against the cwd,
 * and the generated npm script runs with `cwd: backend/`, so "the path is
 * right and the directory is wrong" is the commonest way to arrive here.
 */
export function describeMissingCollectionsPath(typed: string, resolved: string): string {
    return [
        chalk.red(`✗ Collections path not found: "${typed}"`),
        chalk.gray(`    Resolved to: ${resolved}`),
        chalk.gray(`    (relative to cwd: ${process.cwd()})`),
        "",
        chalk.gray("  Nothing was generated and nothing was applied — a schema generated from a"),
        chalk.gray("  directory that is not there is an empty one, and applying it would drop"),
        chalk.gray("  every table it does not describe."),
        "",
        chalk.gray("  Pass an absolute path, or one relative to where you run the command.")
    ].join("\n");
}

/**
 * Refuse a `--collections` path that does not exist.
 *
 * `null` means the flag was not given: the default (`../config/collections`) is
 * left to the loader, which warns and continues — a project may legitimately
 * have no collections directory, and a headless scaffold does.
 */
export function assertCollectionsPathExists(typed: string | null): void {
    if (typed === null) return;

    const resolved = path.resolve(process.cwd(), typed);
    if (fs.existsSync(resolved)) return;

    outError("");
    outError(describeMissingCollectionsPath(typed, resolved));
    outError("");
    throw new CollectionsPathMissing(typed, resolved);
}
