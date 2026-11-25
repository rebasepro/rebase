/**
 * The project's `resources.ts`, evaluated by the driver's own commands.
 *
 * The schema commands load only the schema directory, so nothing else they
 * import would ever evaluate the resources module — and what it declares
 * (which databases exist, the extensions each may install, where each keeps
 * its migrations) is read from the registry it fills.
 */
import * as fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

/** Where a project declares its resources, relative to `backend/` (the schema directory's parent). */
const RESOURCE_ENTRIES = ["resources.ts", "resources.js", "resources/index.ts", "resources/index.js"];

/**
 * Evaluate the project's `resources.ts`, so `declaredDatabaseExtensions()` and
 * the database a `db` command targets (`resolveDatabaseTarget`) can answer.
 *
 * The DDL generator loads only the schema directory, so nothing else in it
 * would ever import the resources module — and a permission that reads as
 * absent because nobody loaded it is the worst shape this could take: the push
 * succeeds, `vector.sql` quietly omits the `CREATE EXTENSION`, and the failure
 * lands one statement later looking like a database problem.
 *
 * Imported directly rather than through the config index, for the reason
 * `boot/resource-loading.ts` gives: re-exporting from the index would work only
 * for projects that remember to.
 *
 * A project with no resources module is the normal case and declares nothing.
 * An import that *throws* is not swallowed — a resources module that does not
 * evaluate is a configuration error, and treating it as "declared nothing"
 * would turn it into a silently missing extension.
 */
export async function loadDeclaredResources(backendDir: string): Promise<void> {
    const entry = RESOURCE_ENTRIES
        .map(name => path.join(backendDir, name))
        .find(candidate => fs.existsSync(candidate));
    if (!entry) return;
    await import(pathToFileURL(entry).href);
}
