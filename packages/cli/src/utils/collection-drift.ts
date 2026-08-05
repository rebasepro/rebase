/**
 * Which edits under `config/collections` can put the *SQL* schema out of date.
 *
 * `rebase dev` watches that directory and, on any change, either tells the
 * developer to run `rebase schema generate` / `rebase db push` or runs them.
 * The watcher is recursive and knows nothing about what it is watching, so it
 * said that about every file under the directory — including a
 * `collections/firestore/exercises.ts`, whose documents live in Firestore and
 * for which there is no Drizzle schema to regenerate and no database to push
 * to. Advice that is wrong on every edit is advice a developer learns to
 * ignore, which is worse than none: the same box is the only warning for the
 * Postgres collection next to it, where it is real.
 *
 * Two independent reasons a change cannot affect the SQL schema, both checked
 * here:
 *
 * 1. **The loader would never read the file.** `loadCollectionsFromDirectory`
 *    reads the top level of the collections directory only — no recursion, no
 *    `index`, no tests, no declarations. A file it does not read cannot change
 *    what it returns, and the watcher must not claim otherwise.
 * 2. **Every collection in it is served by another engine.** A Firestore or
 *    MongoDB collection has no table, no migration and no policies.
 *
 * The engine check reads the source text rather than importing the module: the
 * CLI runs as plain Node and cannot evaluate a project's TypeScript, and a
 * watcher must answer in the time between two keystrokes. Anything it cannot
 * read confidently counts as SQL-affecting — a spurious warning is a nuisance,
 * a suppressed one hides real drift.
 */
import fs from "fs";
import path from "path";
import { DEFAULT_DATA_SOURCE_KEY, getDataSourceCapabilities } from "@rebasepro/types";

/**
 * Would `loadCollectionsFromDirectory` load this file?
 *
 * Mirrors that loader's own `isCollectionFile` plus its flat (non-recursive)
 * scan. `relativePath` is relative to the collections directory, as `fs.watch`
 * reports it.
 */
export function isLoadedCollectionFile(relativePath: string): boolean {
    const normalized = relativePath.split(path.sep).join("/");
    // A nested path is a subdirectory, which the loader does not descend into.
    if (normalized.includes("/")) return false;

    const file = normalized;
    if (!file.endsWith(".ts") && !file.endsWith(".js")) return false;
    if (file.startsWith(".")) return false;
    if (file.includes(".test.")) return false;
    if (file.endsWith(".d.ts")) return false;
    // The directory's own module: defaults live there, not a collection.
    if (file === "index.ts" || file === "index.js") return false;
    return true;
}

const ENGINE_LITERAL = /\bengine\s*:\s*["'`]([^"'`]+)["'`]/g;
const DATA_SOURCE_LITERAL = /\bdataSource\s*:\s*["'`]([^"'`]+)["'`]/g;

/**
 * Drop comments, so a `// engine: "firestore"` in a docblock cannot silence a
 * warning about the Postgres collection the file actually declares.
 *
 * Deliberately naive — it does not understand strings, so a `//` inside one
 * (a URL in a default value) eats the rest of that line. That only ever removes
 * text, and removing an engine literal makes this file *more* likely to warn,
 * which is the side to be wrong on.
 */
function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function literals(source: string, pattern: RegExp): string[] {
    const found: string[] = [];
    for (const match of source.matchAll(pattern)) found.push(match[1]);
    return found;
}

/**
 * Does this collection source declare anything a SQL toolchain would own?
 *
 * The fallback order matches `resolveDataSource`: an explicit `engine` wins,
 * and a collection that only names a `dataSource` is resolved as if the key
 * were the engine — which is what that function does when no registry is
 * available, and the CLI has none. An engine nobody recognises counts as
 * relational, for the reason `isRelationalCollection` gives.
 *
 * A file declaring several collections is SQL-affecting if *any* of them is.
 */
export function declaresRelationalCollection(rawSource: string): boolean {
    const source = stripComments(rawSource);
    const engines = literals(source, ENGINE_LITERAL);
    const declared = engines.length > 0
        ? engines
        : literals(source, DATA_SOURCE_LITERAL).filter(key => key !== DEFAULT_DATA_SOURCE_KEY);

    if (declared.length === 0) return true;
    return declared.some(engine => getDataSourceCapabilities(engine).supportsRelations);
}

/**
 * Can this edit have changed the generated SQL schema?
 *
 * Answers `true` when it cannot tell — an unreadable file is a reason to warn,
 * not a reason to go quiet.
 */
export function affectsSqlSchema(collectionsDir: string, relativePath: string): boolean {
    if (!isLoadedCollectionFile(relativePath)) return false;
    try {
        return declaresRelationalCollection(
            fs.readFileSync(path.join(collectionsDir, relativePath), "utf8")
        );
    } catch {
        // Deleted between the event and the read, or unreadable. Both leave the
        // schema genuinely in question.
        return true;
    }
}
