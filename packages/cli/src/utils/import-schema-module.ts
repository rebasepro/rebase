/**
 * Importing a project's TypeScript modules from a CLI process.
 *
 * The CLI runs as plain Node: no TypeScript loader is registered, and a
 * project's schema modules import each other without extensions (`./users`),
 * which Node's built-in type stripping cannot resolve. So every command that
 * reads a project's `backend/schema` (or any other project module) imports it
 * through jiti, with this one importer — handed to `loadBackendSchema(dir, {
 * importModule })` from `@rebasepro/server`, so the CLI reads tables exactly
 * as the server does.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { SchemaModuleImporter } from "@rebasepro/server";

/**
 * An importer for the modules of the project at `root`.
 *
 * One importer evaluates each module once, so modules that import each other
 * see the same objects (a relation's target is the exported table itself). A
 * new importer sees the files as they are now: what an earlier importer
 * evaluated under `root` is dropped from Node's shared module cache first —
 * a command may write a module and read it back in one process.
 *
 * @param root the project root, absolute
 * @param aliases module specifiers mapped to files. A user's project resolves
 *   through its own `node_modules` and passes none; tests and in-repo runs point
 *   `@rebasepro/*` at the workspace's source so they never read a stale `dist`.
 */
export async function createSchemaModuleImporter(root: string, aliases: Record<string, string> = {}): Promise<SchemaModuleImporter> {
    const cache = createRequire(import.meta.url).cache;
    const prefix = path.resolve(root) + path.sep;
    for (const key of Object.keys(cache)) if (key.startsWith(prefix)) delete cache[key];
    const { createJiti } = await import("jiti");
    const jiti = createJiti(pathToFileURL(path.join(root, "__rebase_import__.ts")).href, {
        alias: aliases,
        interopDefault: true,
        moduleCache: true,
        fsCache: false,
        jsx: true
    });
    return async (file: string) => {
        const loaded: unknown = await jiti.import(file);
        if (typeof loaded !== "object" || loaded === null) return { default: loaded };
        return Object.fromEntries(Object.entries(loaded));
    };
}
