/**
 * The driver's one door to the project's tables.
 *
 * Every command of this package that reads the schema — `db generate`,
 * `db push` and each of its steps, `schema generate`, `schema stale`, the
 * doctor and `console` — calls {@link loadTables}, which reads
 * `backend/schema` through `@rebasepro/server`'s `loadBackendSchema` (the same
 * loader server boot uses) and compiles the definitions into the
 * `CompiledTable`s the planner reads (docs/plans/POSTGRES-FIRST.md Part II D).
 *
 * Nothing is ever skipped: a module that fails to import, a definition the
 * loader refuses (no `rls`, `rls: []`, `"inherit"` without `defaultRls`, a
 * table the index does not export…) is thrown, never swallowed. A table that
 * went missing from `db generate` is a `DROP TABLE` planned, and a table missing
 * from the policy step is a table served under whatever policies it last had.
 */
import fs from "fs";
import path from "path";
import { computeSchemaVersion, DEFAULT_DATA_SOURCE_KEY, type CompiledTable, type TableDescriptor } from "@rebasepro/types";
import { compileLoadedSchema, loadBackendSchema } from "@rebasepro/server";
import { outWarn } from "../cli-output";

/** Directories this process has already said are missing. See {@link loadTables}. */
const warnedMissing = new Set<string>();

/**
 * The project's compiled tables — the planner's input — in slug order.
 *
 * Slug order is part of the contract, not a nicety: `generatePostgresDdl`, the
 * policy generator and the boot planner emit in input order (enums and
 * junction tables interleave with the tables that declare them), so the order
 * here is the order of every generated file. It is the order the generators
 * have always sorted by.
 *
 * A directory that does not exist, or has no index, declares no tables and
 * yields `[]` — the headless (introspection) layout. A directory the user
 * *named* and that does not exist is refused earlier, before anything is
 * written (`assertSchemaDirExists`).
 *
 * @param schemaDir the schema directory, resolved against the working directory.
 * @throws SchemaDefinitionError (from `@rebasepro/common`) naming every table
 *   and key that is wrong, or SchemaLoadError (from `@rebasepro/server`) naming
 *   the file that could not be read.
 */
export async function loadTables(schemaDir: string): Promise<CompiledTable[]> {
    return (await loadTableSchema(schemaDir)).tables;
}

/**
 * The project's tables, loaded once, both ways a driver command reads them.
 *
 * @group Schema
 */
export interface LoadedTables {
    /**
     * The compiled descriptors, in slug order: what the schema-version
     * stamp is computed over, and what `GET /api/schema/tables` serves.
     */
    descriptors: TableDescriptor[];
    /** The compiled tables, in the same slug order: what a driver opened from a script runs on. */
    tables: CompiledTable[];
}

/**
 * {@link loadTables}, with the descriptors beside the compiled tables — for a
 * command that compares the stamp the runtime wrote (the doctor).
 *
 * @param schemaDir the schema directory, resolved against the working directory.
 */
export async function loadTableSchema(schemaDir: string): Promise<LoadedTables> {
    const resolved = path.resolve(schemaDir);
    if (!fs.existsSync(resolved) && !warnedMissing.has(resolved)) {
        // Once per directory per process: `db push` reads the tables from
        // every step. Said at all because the commonest way to get here is the
        // right directory from the wrong cwd, and "no tables" generates an
        // empty schema.
        warnedMissing.add(resolved);
        outWarn(
            `  ⚠  No schema directory at "${schemaDir}" — reading no tables.\n` +
            `     Resolved to: ${resolved}\n` +
            `     (relative to cwd: ${process.cwd()})\n` +
            "     Run the command from backend/, or pass --schema-dir <dir>."
        );
    }
    const loaded = await loadBackendSchema(resolved);
    const compiled = compileLoadedSchema(loaded);
    const bySlug = (a: { slug: string }, b: { slug: string }): number => a.slug.localeCompare(b.slug);
    return {
        descriptors: [...compiled.descriptors].sort(bySlug),
        tables: [...compiled.tables].sort((a, b) => bySlug(a.descriptor, b.descriptor))
    };
}

/**
 * The schema version of what `rebase db push` provisions: the descriptors of
 * the tables the default database holds.
 *
 * Exactly the set, and the function, the server stamps at boot
 * (`enforceSchemaStamp` over the descriptors of the tables it provisions in
 * the default database, hashed by `computeSchemaVersion`), so a database
 * stamped by a push and the server that boots against it compute the same
 * version — and the doctor, reading it, compares like with like.
 *
 * @group Schema
 */
export function defaultDatabaseSchemaVersion(loaded: LoadedTables): string {
    return computeSchemaVersion(loaded.descriptors.filter(descriptor =>
        !descriptor.database || descriptor.database === DEFAULT_DATA_SOURCE_KEY));
}
