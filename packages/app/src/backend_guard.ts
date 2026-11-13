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
 * And the ways a build pulls a file in without an `import` statement, which
 * Vite resolves outside the plugin chain:
 *
 * - `new URL("…", import.meta.url)` (an asset, inlined as a `data:` URL under
 *   `assetsInlineLimit`, a worker's entry with `new Worker(new URL(…))`) and
 *   a stylesheet's `@import` / `url()`: `transform` reads each literal a
 *   project module or stylesheet names and resolves it, as Vite would;
 * - an `index.html` `src` / `href`: `transformIndexHtml` does the same;
 * - a worker (`?worker`, `new Worker(new URL(…))`) is bundled by a build of
 *   its own, with `worker.plugins`: the guard adds itself there;
 * - whatever still reaches the output — a chunk holding a backend module, an
 *   asset made from a backend file — fails `generateBundle`.
 *
 * (`?raw`, `?url`, `?inline`, `?worker`, `import.meta.glob` and a `new URL`
 * template literal, which Vite turns into a glob, are imports: `resolveId`.)
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
    /**
     * The file was named outside an `import` — `new URL(…, import.meta.url)`, a
     * stylesheet's `@import` / `url()`, an HTML `src` / `href` — so the build
     * copies or inlines it rather than bundling a module.
     */
    reference?: boolean;
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
        ? `${show(importer)} ${options.reference ? "references" : "imports"} "${options.specifier}", which resolves to ${target}`
        : importer
            ? `${target} is imported by ${show(importer)}`
            : `${target} was requested by the frontend's dev server or module graph`;
    if (options.reference) {
        return [
            `[${BACKEND_GUARD_PLUGIN_NAME}] ${what} — a file under backend/.`,
            "A file named by `new URL(…, import.meta.url)`, a stylesheet's `@import` / `url()` or an HTML `src` / `href` is",
            "copied or inlined into the build's output, and so served to every visitor of the site.",
            "Move the file the frontend needs out of backend/ (into the frontend, or its public/ directory)."
        ].join("\n");
    }
    const typeImport = options.specifier ? `import type { … } from "${options.specifier}"` : "import type { … } from \"…\"";
    return [
        `[${BACKEND_GUARD_PLUGIN_NAME}] ${what} — a file under backend/.`,
        "A frontend imports the backend as types only. A value import ships that file to every visitor of the site,",
        "with its hooks and every server module, API client and secret they reach.",
        `Write \`${typeImport}\` (the compiler erases it), or move the value both sides need to a file outside backend/.`,
        "An `import.meta.glob` pattern that matches backend/ files counts as one import per match; `import { type x }` still loads the module."
    ].join("\n");
}

/** A stylesheet Vite processes: CSS and its preprocessors. */
const STYLESHEET = /\.(?:css|pcss|postcss|scss|sass|less|styl|stylus|sss)(?:$|[?#])/i;

/**
 * Every literal path a module names outside its `import` statements, that a
 * Vite build turns into a file of the output: `new URL("…", import.meta.url)`
 * in a script; `@import` / `@use` / `@forward` and `url(…)` in a stylesheet.
 * Template literals with a placeholder are left out (Vite makes them an
 * `import.meta.glob`, which resolves through the plugin chain), and so are
 * URLs that name no file (`data:`, `http:`, `#fragment`).
 */
export function referencedPaths(code: string, id: string): string[] {
    const out: string[] = [];
    if (STYLESHEET.test(id)) {
        for (const match of code.matchAll(/@(?:import|use|forward)\s+(?:url\(\s*)?(["']?)([^"')\s;]+)\1/g)) out.push(match[2]);
        for (const match of code.matchAll(/url\(\s*(["']?)([^"')]+?)\1\s*\)/g)) out.push(match[2]);
    } else if (code.includes("import.meta.url")) {
        for (const match of code.matchAll(/\bnew\s+URL\s*\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1\s*,\s*import\.meta\.url\s*\)/g)) {
            if (match[1] === "`" && match[2].includes("${")) continue;
            out.push(match[2]);
        }
    }
    return [...new Set(out.map(spec => spec.trim()).filter(spec => spec !== "" && !/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(spec)))];
}

/** Every `src` / `href` (and each `srcset` candidate) an HTML document names. */
export function htmlReferencedPaths(html: string): string[] {
    const out: string[] = [];
    for (const match of html.matchAll(/\s(src|href|srcset)\s*=\s*(["'])([^"']*)\2/gi)) {
        const values = match[1].toLowerCase() === "srcset"
            ? match[3].split(",").map(candidate => candidate.trim().split(/\s+/)[0])
            : [match[3]];
        out.push(...values);
    }
    return [...new Set(out.map(spec => spec.trim()).filter(spec => spec !== "" && !/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(spec)))];
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
    return backendGuardPlugin(options, false);
}

/**
 * The guard, for the page's build or — `inWorker` — for the build of one of
 * its workers, which Vite runs with `worker.plugins` alone.
 */
function backendGuardPlugin(options: RebaseBackendGuardOptions, inWorker: boolean): Plugin {
    let realBackend: string | undefined;
    let projectRoot = "";
    let viteRoot = "";
    /** Vite's own resolver for a path a stylesheet or `new URL` names (aliases applied, as Vite applies them). */
    let resolveReference: ((id: string, importer: string) => Promise<string | undefined>) | undefined;

    /** Set once the backend is known; matches nothing until then. */
    const idFilter: { id: RegExp } = { id: /(?!)/ };
    /** `transform` also reads the project's own modules (anything outside `node_modules`). */
    const transformFilter: { id: RegExp } = { id: /(?!)/ };
    const refuse = (id: string | undefined): boolean => realBackend !== undefined && id !== undefined && isModuleInDir(id, realBackend);
    const inProject = (file: string | undefined): file is string => file !== undefined
        && file.startsWith(projectRoot + path.sep) && !/[\\/]node_modules[\\/]/.test(file);

    return {
        name: BACKEND_GUARD_PLUGIN_NAME,
        enforce: "pre",
        apply: () => !process.env.VITEST,
        config(userConfig) {
            if (inWorker) return undefined;
            // A worker is bundled by a build of its own, which runs
            // `worker.plugins` and nothing else: without this, a worker that
            // imports `backend/` ships it whatever the page's build refuses.
            const userWorkerPlugins = userConfig.worker?.plugins;
            return {
                worker: {
                    plugins: () => [...(userWorkerPlugins ? userWorkerPlugins() : []), backendGuardPlugin(options, true)]
                }
            };
        },
        configResolved(config: ResolvedConfig) {
            viteRoot = config.root;
            // What Vite's CSS `@import` and `new URL(…, import.meta.url)`
            // handling resolve with: the alias and the file system, no plugin.
            // (Deprecated for `createIdResolver`, a value import of `vite`,
            // which this type-only module does not make.)
            const resolver = config.createResolver({ preferRelative: true, tryIndex: false, extensions: [] });
            resolveReference = (id, importer) => resolver(id, importer);
            const configured = options.backendDir === undefined ? undefined : path.resolve(config.root, options.backendDir);
            const backend = configured ?? findProjectBackendDir(config.root);
            if (backend === undefined) return;
            if (!isDirectory(backend)) {
                if (configured !== undefined && !inWorker) {
                    config.logger.warn(`[${BACKEND_GUARD_PLUGIN_NAME}] backendDir ${configured} is not a directory; nothing is guarded.`);
                }
                return;
            }
            realBackend = realPath(backend);
            projectRoot = path.dirname(realBackend);
            // Any path segment named like the backend, in any case (the
            // handler then decides by real path).
            const names = [...new Set([path.basename(backend), path.basename(realBackend)])].map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
            const backendSegment = `[\\\\/](?:${names.join("|")})(?:[\\\\/?#]|$)`;
            idFilter.id = new RegExp(backendSegment, "i");
            transformFilter.id = new RegExp(`^(?![\\s\\S]*[\\\\/]node_modules[\\\\/])|${backendSegment}`, "i");
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
        // Hook filters: the bundler calls these only for ids under a directory
        // named like the backend's (and, for `transform`, the project's own
        // modules), instead of crossing into JavaScript for every module of
        // the graph (that cost showed up as most of a scaffold build's plugin time).
        load: {
            filter: idFilter,
            handler(id, loadOptions) {
                if (loadOptions?.ssr || !refuse(id)) return null;
                const importer = this.getModuleInfo(id)?.importers[0];
                this.error(backendImportMessage({ projectRoot, importer, resolved: id }));
            }
        },
        transform: {
            filter: transformFilter,
            async handler(code, id, transformOptions) {
                if (transformOptions?.ssr) return null;
                if (refuse(id)) {
                    const importer = this.getModuleInfo(id)?.importers[0];
                    this.error(backendImportMessage({ projectRoot, importer, resolved: id }));
                }
                // The paths Vite reads outside the plugin chain: an asset or a
                // worker's entry by `new URL(…, import.meta.url)`, a stylesheet's
                // `@import` / `url()`. Resolved as Vite resolves them (aliases
                // included), then judged by where they land.
                const file = fileOfModuleId(id);
                if (!inProject(file)) return null;
                for (const specifier of referencedPaths(code, id)) {
                    const landed = await landing(this, resolveReference, specifier, file);
                    if (landed !== undefined && refuse(landed)) {
                        this.error(backendImportMessage({ projectRoot, importer: id, specifier, resolved: landed, reference: true }));
                    }
                }
                return null;
            }
        },
        transformIndexHtml: {
            order: "pre",
            handler(html, context) {
                if (realBackend === undefined) return;
                const htmlFile = path.isAbsolute(context.filename) ? context.filename : path.join(viteRoot, context.path);
                for (const specifier of htmlReferencedPaths(html)) {
                    const landed = specifier.startsWith("/")
                        ? path.join(viteRoot, specifier)
                        : path.resolve(path.dirname(htmlFile), specifier.replace(/[?#].*$/, ""));
                    if (refuse(landed)) {
                        throw new Error(backendImportMessage({ projectRoot, importer: htmlFile, specifier, resolved: landed, reference: true }));
                    }
                }
            }
        },
        // The net under all of the above: nothing made from a backend file
        // leaves the build, whatever path brought it in.
        generateBundle(_outputOptions, bundle) {
            if (realBackend === undefined) return;
            for (const output of Object.values(bundle)) {
                const sources = output.type === "chunk" ? output.moduleIds : output.originalFileNames;
                const leaked = sources.find(source => refuse(source));
                if (leaked !== undefined) {
                    this.error(backendImportMessage({ projectRoot, resolved: leaked }) +
                        `\nIt reached the build's output as ${output.fileName}.`);
                }
            }
        }
    };
}

/**
 * The file a literal path a module names lands on: through Vite's own
 * reference resolver first (aliases, as its `new URL` and stylesheet handling
 * resolve), then the plugin chain, else relative to the importing file. A root-relative path
 * (`/…`) is the public directory's, which holds no backend file.
 */
async function landing(
    context: { resolve: (source: string, importer?: string, options?: { skipSelf?: boolean }) => Promise<{ id: string; external?: boolean | "absolute" | "relative" } | null> },
    resolveReference: ((id: string, importer: string) => Promise<string | undefined>) | undefined,
    specifier: string,
    importerFile: string
): Promise<string | undefined> {
    const bare = specifier.replace(/[?#].*$/, "");
    if (bare.startsWith("/")) return undefined;
    try {
        const resolved = await resolveReference?.(bare, importerFile);
        if (resolved) return resolved;
    } catch {
        // Falls through to the plugin chain.
    }
    try {
        const resolved = await context.resolve(specifier, importerFile, { skipSelf: true });
        if (resolved && !resolved.external) return resolved.id;
    } catch {
        // Not a module the chain knows: judged by its path below.
    }
    return path.resolve(path.dirname(importerFile), bare);
}
