/**
 * The frontend's build refuses every module that resolves into `backend/`.
 *
 * A project keeps its tables in `backend/schema` — with their server hooks,
 * which may import API clients and read secrets at module scope — and the
 * admin panel's customizations in `frontend/src/cms`, which reference those
 * tables for their TYPES: `import type { posts } from
 * "../../../backend/schema/posts"`. The compiler erases a type import. A
 * value import of the same file puts the table into the browser bundle, and
 * with it every hook, every module the hooks reach and every value those
 * modules compute at load: one mistaken `import` ships server source to
 * every visitor, and the build, the panel and the tests all keep working.
 *
 * A lint over the import's spelling cannot hold that line: an alias, a
 * tsconfig path, a `#subpath` import, the backend's package name, an absolute
 * path, an `import.meta.glob` or a re-export through another directory all
 * reach the same file. This plugin checks where an import LANDS instead —
 * after every other plugin has resolved it — so the spelling does not matter.
 * Type-only imports are gone before resolution, so whatever still reaches
 * `backend/` here is a value import.
 *
 * Three hooks, one rule:
 *
 * - `resolveId` re-resolves each import made by a project module (a file
 *   under the project root, outside `node_modules`) through the rest of the
 *   plugin chain and refuses a result under `backend/`, naming the importing
 *   file and the import as written.
 * - `load` and `transform` refuse any module id under `backend/` that reached
 *   the graph some other way: an import from a module outside the project (a
 *   linked workspace package), a plugin that resolved it before this one ran,
 *   a dev-server request for `/@fs/…/backend/…`.
 *
 * Paths are compared as real paths (`fs.realpathSync.native`), so a symlinked
 * workspace package (`node_modules/my-backend → ../backend`), a
 * `preserveSymlinks` build and a case-insensitive file system all land on the
 * same answer.
 *
 * Applies to the browser's module graph: an SSR environment's modules run on
 * the server, and Vitest runs the frontend's tests in Node, where importing a
 * table to test against is fine.
 */
import fs from "fs";
import path from "path";
import type { Plugin, ResolvedConfig } from "vite";

/** The name the guard registers under; `rebase build` and `rebase verify` look for it. */
export const BACKEND_GUARD_PLUGIN_NAME = "rebase-backend-guard";

/** Options of {@link rebaseBackendGuard}. */
export interface RebaseBackendGuardOptions {
    /**
     * The directory no module of the frontend may resolve into, absolute or
     * relative to the Vite root. Default: `backend/` of the project the Vite
     * root belongs to — the nearest directory above it that holds a
     * `rebase.json`, or a `package.json` beside a `backend/` directory (how
     * the `rebase` CLI finds the project).
     */
    backendDir?: string;
}

/**
 * The project's `backend/` directory for a Vite root, found the way the CLI
 * finds the project: walking up from `root`, the first directory that holds a
 * `rebase.json`, or a `package.json` beside a `backend/` directory. Undefined
 * when there is no such project, or it has no `backend/`.
 */
export function findProjectBackendDir(root: string): string | undefined {
    let dir = path.resolve(root);
    for (;;) {
        const backend = path.join(dir, "backend");
        const isProject = fs.existsSync(path.join(dir, "rebase.json")) ||
            (fs.existsSync(path.join(dir, "package.json")) && isDirectory(backend));
        if (isProject) return isDirectory(backend) ? backend : undefined;
        const parent = path.dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
    }
}

function isDirectory(file: string): boolean {
    try {
        return fs.statSync(file).isDirectory();
    } catch {
        return false;
    }
}

/**
 * The real path of `file`: symlinks followed and, on a case-insensitive file
 * system, the case as stored. A path that does not exist (yet) keeps its
 * missing tail under the real path of its nearest existing ancestor.
 */
export function realPath(file: string): string {
    const missing: string[] = [];
    let current = path.resolve(file);
    for (;;) {
        try {
            return path.join(fs.realpathSync.native(current), ...missing.reverse());
        } catch {
            const parent = path.dirname(current);
            if (parent === current) return path.resolve(file);
            missing.push(path.basename(current));
            current = parent;
        }
    }
}

/**
 * The file a module id names, or undefined when it names none: a virtual
 * module (`\0…`, `virtual:…`), a bare package name, a URL. Drops the query
 * (`?raw`, `?url`, `?import`) and Vite's `/@fs/` prefix.
 */
export function fileOfModuleId(id: string): string | undefined {
    if (id.startsWith("\0") || id.startsWith("virtual:")) return undefined;
    let file = id;
    const query = file.search(/[?#]/);
    if (query >= 0) file = file.slice(0, query);
    if (file.startsWith("/@fs/")) file = file.slice("/@fs".length);
    if (file.startsWith("file://")) {
        try {
            file = new URL(file).pathname;
        } catch {
            return undefined;
        }
    }
    return path.isAbsolute(file) ? file : undefined;
}

/** Whether `id` names a file inside `realDir` (itself a real path), compared by real path. */
export function isModuleInDir(id: string, realDir: string): boolean {
    const file = fileOfModuleId(id);
    if (file === undefined) return false;
    const real = realPath(file);
    return real === realDir || real.startsWith(realDir + path.sep);
}

/** What a refused import says: the importer, the import as written, where it landed, and what to write instead. */
export function backendImportMessage(options: {
    /** The directory paths are shown relative to (the project root). */
    projectRoot: string;
    importer?: string;
    /** The import as written, when known. */
    specifier?: string;
    /** The resolved module id. */
    resolved: string;
}): string {
    const show = (file: string): string => {
        const relative = path.relative(options.projectRoot, file);
        return relative.startsWith("..") || path.isAbsolute(relative) ? file : relative;
    };
    const resolvedFile = fileOfModuleId(options.resolved);
    // The real path: through a symlinked package or in another case, the file it is.
    const target = resolvedFile === undefined ? options.resolved : show(realPath(resolvedFile));
    const importer = options.importer ? fileOfModuleId(options.importer) ?? options.importer : undefined;
    const what = importer && options.specifier
        ? `${show(importer)} imports "${options.specifier}", which resolves to ${target}`
        : importer
            ? `${target} is imported by ${show(importer)}`
            : `${target} was requested by the frontend's dev server or module graph`;
    const typeImport = options.specifier ? `import type { … } from "${options.specifier}"` : "import type { … } from \"…\"";
    return [
        `[${BACKEND_GUARD_PLUGIN_NAME}] ${what} — a file under backend/.`,
        "A frontend imports the backend as types only. A value import ships that file to every visitor of the site,",
        "with its hooks and every server module, API client and secret they reach.",
        `Write \`${typeImport}\` (the compiler erases it), or move the value both sides need to a file outside backend/.`,
        "An `import.meta.glob` pattern that matches backend/ files counts as one import per match; `import { type x }` still loads the module."
    ].join("\n");
}

/**
 * Fail the build — and, in the dev server, the module's load — when any
 * module of the frontend's graph resolves to a file under the project's
 * `backend/` directory.
 *
 * Every Rebase frontend's `vite.config.ts` lists it; `rebase build` refuses a
 * project whose Vite config does not, and `rebase verify` reports it
 * (`cms-backend-guard-missing`).
 *
 * @example
 * ```ts
 * import { rebaseBackendGuard } from "@rebasepro/app/vitePlugin";
 *
 * export default defineConfig({
 *     plugins: [react(), rebaseBackendGuard()]
 * });
 * ```
 */
export function rebaseBackendGuard(options: RebaseBackendGuardOptions = {}): Plugin {
    let realBackend: string | undefined;
    let projectRoot = "";

    /** Set once the backend is known; matches nothing until then. */
    const idFilter: { id: RegExp } = { id: /(?!)/ };
    const refuse = (id: string | undefined): boolean => realBackend !== undefined && id !== undefined && isModuleInDir(id, realBackend);

    return {
        name: BACKEND_GUARD_PLUGIN_NAME,
        enforce: "pre",
        apply: () => !process.env.VITEST,
        configResolved(config: ResolvedConfig) {
            const configured = options.backendDir === undefined ? undefined : path.resolve(config.root, options.backendDir);
            const backend = configured ?? findProjectBackendDir(config.root);
            if (backend === undefined) return;
            if (!isDirectory(backend)) {
                if (configured !== undefined) {
                    config.logger.warn(`[${BACKEND_GUARD_PLUGIN_NAME}] backendDir ${configured} is not a directory; nothing is guarded.`);
                }
                return;
            }
            realBackend = realPath(backend);
            projectRoot = path.dirname(realBackend);
            // Any path segment named like the backend, in any case (the
            // handler then decides by real path).
            const names = [...new Set([path.basename(backend), path.basename(realBackend)])].map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
            idFilter.id = new RegExp(`[\\\\/](?:${names.join("|")})(?:[\\\\/?#]|$)`, "i");
        },
        async resolveId(source, importer, resolveOptions) {
            if (realBackend === undefined || importer === undefined || resolveOptions?.ssr) return null;
            if (source.startsWith("\0") || importer.startsWith("\0") || /[\\/]node_modules[\\/]/.test(importer)) return null;
            // Re-resolving costs a second trip through every resolver, so only
            // the project's own modules pay it. A module outside the project (a
            // linked workspace package, a dependency) that reaches backend/ is
            // still refused, by `load` and `transform`, without the import as written.
            // A prefix test, not a real path: the bundler's ids are real paths
            // already, and this runs for every import of the graph.
            const importerFile = fileOfModuleId(importer);
            if (importerFile === undefined || !importerFile.startsWith(projectRoot + path.sep)) return null;
            const resolved = await this.resolve(source, importer, { ...resolveOptions, skipSelf: true });
            if (resolved && !resolved.external && refuse(resolved.id)) {
                // A dev-server request for `/@fs/…` is a URL, not an import anyone wrote.
                const requested = source.startsWith("/@fs/");
                this.error(backendImportMessage({ projectRoot, importer: requested ? undefined : importer, specifier: requested ? undefined : source, resolved: resolved.id }));
            }
            return null;
        },
        // Hook filters: the bundler calls these two only for ids under a
        // directory named like the backend's, instead of crossing into
        // JavaScript for every module of the graph (that cost showed up as
        // most of a scaffold build's plugin time).
        load: {
            filter: idFilter,
            handler(id, loadOptions) {
                if (loadOptions?.ssr || !refuse(id)) return null;
                const importer = this.getModuleInfo(id)?.importers[0];
                this.error(backendImportMessage({ projectRoot, importer, resolved: id }));
            }
        },
        transform: {
            filter: idFilter,
            handler(_code, id, transformOptions) {
                if (transformOptions?.ssr || !refuse(id)) return null;
                const importer = this.getModuleInfo(id)?.importers[0];
                this.error(backendImportMessage({ projectRoot, importer, resolved: id }));
            }
        }
    };
}
