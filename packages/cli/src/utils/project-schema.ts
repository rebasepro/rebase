/**
 * The project's `backend/schema`, imported in this process — for the commands
 * that read the tables themselves rather than through the driver: `rebase
 * verify`, `rebase build`, `rebase resources`, `rebase generate-sdk`.
 *
 * Through `loadBackendSchema` from `@rebasepro/server`, the one definition of
 * "the tables" that boot, the runtime and the driver also read, so a command
 * here can never accept a schema the server refuses (or the reverse): a table
 * with no `rls`, an index that does not export a sibling's table, a project
 * still on the collections layout — each is the loader's error, word for word.
 * Modules are imported with the CLI's one importer
 * (`createSchemaModuleImporter`), so a file written earlier in the same
 * process is read as it is now.
 */
import type { CompiledSchema, LoadedSchema } from "@rebasepro/server";
import { createSchemaModuleImporter } from "./import-schema-module";

/** The project's schema, as the loader read it and as it compiles. */
export interface ProjectSchema {
    loaded: LoadedSchema;
    compiled: CompiledSchema;
}

/**
 * Module specifiers mapped to files, for the importer. A user's project
 * resolves through its own `node_modules` and passes none; tests and in-repo
 * runs point `@rebasepro/*` at the workspace's source.
 */
export type ModuleAliases = Record<string, string>;

/**
 * Import and compile a project's schema directory.
 *
 * Throws what the loader throws: `SchemaLoadError` (a module that does not
 * import, the legacy layout, a definition the index does not export) or
 * `SchemaDefinitionError` from `@rebasepro/common` (every problem with every
 * definition, one per line). A directory that does not exist, or has no
 * index, declares no tables: `descriptors` is empty.
 *
 * @param projectRoot the project root — where a leftover legacy collections
 *   directory would be, and what the importer is rooted at.
 * @param schemaDir the schema directory, absolute.
 */
export async function loadProjectSchema(
    projectRoot: string,
    schemaDir: string,
    aliases: ModuleAliases = {}
): Promise<ProjectSchema> {
    const { loadBackendSchema, compileLoadedSchema } = await import("@rebasepro/server");
    const importModule = await createSchemaModuleImporter(projectRoot, aliases);
    const loaded = await loadBackendSchema(schemaDir, { projectRoot, importModule });
    return { loaded, compiled: compileLoadedSchema(loaded) };
}
