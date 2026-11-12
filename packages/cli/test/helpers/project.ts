/**
 * A Rebase project on disk, in the layout `rebase init` writes, from a compact
 * description — the one fixture every CLI test that needs a project builds.
 *
 *     const root = scaffoldProject({
 *         tables: [defineTable("notes", { columns: { id: col.uuid().primaryKey() }, rls: "admin-only" })],
 *         resources: 'import { bucket } from "@rebasepro/types";\nexport const media = bucket("media");\n'
 *     });
 *
 * Tables are written the way the codemod and the schema editor write them —
 * `printTableModule` / `printIndexModule` from `@rebasepro/common`, one
 * `backend/schema/<name>.ts` per table and an `index.ts` re-exporting them —
 * so a test reads files a real project would hold, not objects it built in
 * memory. Those modules import `@rebasepro/server/schema`, which a temporary
 * directory cannot resolve: pass {@link workspaceModuleAliases} to the command
 * under test (`moduleAliases`) and they load from this repository's source.
 * A test that drives a command through its argv, where no aliases can be
 * passed, writes the modules against {@link TYPES_SOURCE} instead — the
 * builders' own source file, by absolute path, which needs no resolution.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { printIndexModule, printTableModule, tableIdentifier } from "@rebasepro/common";
import type { AnyTableDef, AnyViewDef, DefaultRls, RebaseProjectManifest } from "@rebasepro/types";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

/**
 * `@rebasepro/types`'s source entry, absolute. It exports every builder and
 * imports nothing outside its package, so a schema module that imports from it
 * loads in any directory, with no `node_modules` and no aliases.
 */
export const TYPES_SOURCE = path.join(REPO, "packages", "types", "src", "index.ts");

/** What {@link scaffoldProject} writes. Every part is optional. */
export interface ProjectSpec {
    /** The directory to write into. A new temporary directory when omitted. */
    root?: string;
    /** The tables and views, one module each under the schema directory, re-exported by its index. */
    tables?: readonly (AnyTableDef | AnyViewDef)[];
    /** The index's `defaultRls`. */
    defaultRls?: DefaultRls;
    /**
     * What the table modules import the builders from. `@rebasepro/server/schema`
     * (what a project writes) when omitted; {@link TYPES_SOURCE} for a test
     * that cannot hand the command aliases.
     */
    specifier?: string;
    /**
     * Where the schema directory is, relative to the root. Not the default
     * (`backend/schema`): written to `rebase.json` as the backend's `tables`.
     */
    tablesDir?: string;
    /** `backend/resources.ts`, as source. */
    resources?: string;
    /** `backend/storage.ts`, as source. */
    storage?: string;
    /** `backend/hooks.ts`, as source. */
    hooks?: string;
    /** Any other file, by path relative to the root, as text. */
    files?: Record<string, string>;
    /**
     * `rebase.json`. A backend app named `backend` (with `tables` when
     * {@link tablesDir} is set) when omitted; `false` writes none.
     */
    manifest?: RebaseProjectManifest | false;
    /**
     * `backend/package.json`'s dependencies. The Postgres driver when omitted,
     * so `getActiveBackendPlugin` finds one; `false` writes no backend package.
     */
    backendDependencies?: Record<string, string> | false;
}

/** The schema directory {@link scaffoldProject} writes for a spec, relative to the root. */
export function tablesDirOf(spec: Pick<ProjectSpec, "tablesDir">): string {
    return spec.tablesDir ?? path.join("backend", "schema");
}

function write(root: string, relative: string, contents: string): void {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
}

/**
 * The tables as modules in `schemaDir` (absolute): `<name>.ts` each, and an
 * `index.ts` exporting them in the order given, with `defaultRls`.
 */
export function writeTableModules(
    schemaDir: string,
    tables: readonly (AnyTableDef | AnyViewDef)[],
    defaultRls?: DefaultRls,
    specifier?: string
): void {
    fs.mkdirSync(schemaDir, { recursive: true });
    for (const table of tables) {
        fs.writeFileSync(path.join(schemaDir, `${table.name}.ts`), printTableModule(table, specifier ? { specifier } : {}));
    }
    fs.writeFileSync(
        path.join(schemaDir, "index.ts"),
        printIndexModule(
            tables.map(table => ({ identifier: tableIdentifier(table.name), importPath: `./${table.name}` })),
            defaultRls !== undefined ? { defaultRls } : {}
        )
    );
}

/** Write a project from `spec`, and return its root. */
export function scaffoldProject(spec: ProjectSpec = {}): string {
    const root = spec.root ?? fs.mkdtempSync(path.join(os.tmpdir(), "rebase-cli-project-"));
    fs.mkdirSync(root, { recursive: true });

    if (spec.manifest !== false) {
        const manifest: RebaseProjectManifest = spec.manifest ?? {
            rebase: "^1",
            apps: {
                backend: {
                    type: "backend",
                    runtime: "managed",
                    ...(spec.tablesDir !== undefined ? { tables: spec.tablesDir } : {})
                }
            }
        };
        write(root, "rebase.json", `${JSON.stringify(manifest, null, 2)}\n`);
    }

    if (spec.backendDependencies !== false) {
        write(root, path.join("backend", "package.json"), `${JSON.stringify({
            name: "backend",
            private: true,
            type: "module",
            dependencies: spec.backendDependencies ?? { "@rebasepro/server-postgres": "workspace:*" }
        }, null, 2)}\n`);
    }

    if (spec.tables !== undefined) {
        writeTableModules(path.join(root, tablesDirOf(spec)), spec.tables, spec.defaultRls, spec.specifier);
    }
    if (spec.resources !== undefined) write(root, path.join("backend", "resources.ts"), spec.resources);
    if (spec.storage !== undefined) write(root, path.join("backend", "storage.ts"), spec.storage);
    if (spec.hooks !== undefined) write(root, path.join("backend", "hooks.ts"), spec.hooks);
    for (const [relative, contents] of Object.entries(spec.files ?? {})) write(root, relative, contents);

    return root;
}

/**
 * `@rebasepro/<name>` → `packages/<name>/src/index.ts` for every workspace
 * package, and `@rebasepro/server/schema` → its source entry: what a project's
 * modules import, resolved to this repository's source rather than a `dist`
 * that may predate the change under test.
 */
export function workspaceModuleAliases(): Record<string, string> {
    const aliases: Record<string, string> = {};
    for (const name of fs.readdirSync(path.join(REPO, "packages"))) {
        const source = path.join(REPO, "packages", name, "src", "index.ts");
        if (fs.existsSync(source)) aliases[`@rebasepro/${name}`] = source;
    }
    aliases["@rebasepro/server/schema"] = path.join(REPO, "packages", "server", "src", "schema", "index.ts");
    return aliases;
}
