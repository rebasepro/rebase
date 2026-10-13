import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { Hono } from "hono";
import type { HonoEnv } from "../api/types";
import { logger } from "../utils/logger.js";
import { nativeDynamicImport, type ModuleImporter } from "../utils/dynamic-import.js";
import { describeLoadFailure, SYNTAX_ERROR_ADVICE } from "../utils/load-failure.js";
import { warnDeprecated } from "@rebasepro/common";

/**
 * One custom function: a Hono app, served at `<functions mount>/<name>`.
 *
 * What `defineFunction(...)` returns, and what a function file default-exports:
 * a Hono app over {@link HonoEnv}, the environment a function runs in — build
 * one by hand as `new Hono<HonoEnv>()`. Any Hono-compatible app works at
 * runtime — the loader checks for `.fetch()` and `.routes` rather than an
 * `instanceof`, because a project and the server can hold two copies of hono.
 */
export type FunctionApp = Hono<HonoEnv>;

/**
 * Functions as values: the URL segment each one answers at, to its app.
 *
 * `functions: { "send-invoice": sendInvoice }` serves `sendInvoice` at
 * `/api/functions/send-invoice` — the same thing a file named
 * `functions/send-invoice.ts` does. {@link loadFunctions} returns exactly this
 * shape, so `functions: await loadFunctions(dir)` and `functionsDir: dir` serve
 * the same routes.
 */
export type FunctionsRecord = Record<string, FunctionApp>;

/** How a directory of modules is read. Shared by the function and cron loaders. */
export interface LoadDirectoryOptions {
    /**
     * How a module file is imported. Defaults to the runtime's own `import()`;
     * a caller with its own loader hooks (tsx, a test runner's sandbox) passes
     * `url => import(url)` so they apply.
     */
    importModule?: ModuleImporter;
    /**
     * Called once for every file the loader saw and did **not** load, as
     * `<file> (<reason>)`. The files are skipped either way — one malformed
     * file must not take the others with it — and logged; this is how a caller
     * reports them anywhere else.
     */
    onSkip?: (problem: string) => void;
}

/**
 * Load the custom functions in a directory, as values.
 *
 * Each file default-exports a Hono app — `defineFunction(...)` — or a factory
 * returning one. The filename without its extension is the record key, which
 * is the URL segment it is served at: `functions/send-invoice.ts` →
 * `{ "send-invoice": app }`. Only the top level is read.
 *
 * Never throws for a bad file: it is skipped, logged, and passed to
 * `options.onSkip`.
 *
 * @example
 * ```ts
 * const functions = await loadFunctions(path.resolve("functions"));
 * const backend = await createRebaseBackend({ database, functions, provision: true });
 * ```
 */
export async function loadFunctions(directory: string, options: LoadDirectoryOptions = {}): Promise<FunctionsRecord> {
    const { functions, problems } = await readFunctionsDirectory(directory, options.importModule);
    if (options.onSkip) for (const problem of problems) options.onSkip(problem);
    return functions;
}

/** A loaded function, by name. The shape {@link createFunctionRoutes} mounts. */
export interface LoadedFunction {
    /** Endpoint name derived from filename (e.g., "send-invoice") */
    name: string;
    /** The Hono sub-app to mount */
    app: FunctionApp;
}

/** What a directory of function files produced: what mounted, and what did not. */
export interface LoadedFunctions {
    /** The functions that will be served. */
    functions: LoadedFunction[];
    /**
     * One entry per file the loader saw and did **not** mount, each already
     * phrased as `<name> (<reason>)`.
     */
    problems: string[];
}

/** A record of functions as the list {@link createFunctionRoutes} mounts, in record order. */
export function functionList(functions: FunctionsRecord): LoadedFunction[] {
    return Object.entries(functions).map(([name, app]) => ({ name, app }));
}

/**
 * Extensions the bundler compiles (or a developer might reasonably write) that
 * this loader cannot import. `rebase build` globs `functions/**\/*.ts`, so the
 * build's idea of "a function file" is strictly wider than the runtime's — the
 * worst direction for a mismatch to go. Anything listed here is reported as a
 * problem instead of vanishing; non-code files (`.md`, `.json`, `.txt`) stay
 * silent, because a README next to your functions is not a mistake.
 */
const UNSUPPORTED_CODE_EXTENSIONS = [".mts", ".cts", ".tsx", ".jsx", ".mjs", ".cjs"];

/**
 * @deprecated Use `loadFunctions` instead, which returns the functions as a
 * record keyed by name. Will be removed in a future release.
 */
export async function loadFunctionsFromDirectory(
    directory: string,
    importModule: ModuleImporter = nativeDynamicImport
): Promise<LoadedFunction[]> {
    warnDeprecated(
        "server.loadFunctionsFromDirectory",
        "`loadFunctionsFromDirectory` is deprecated; use `loadFunctions(dir)`, which returns `{ [name]: app }`."
    );
    return functionList((await readFunctionsDirectory(directory, importModule)).functions);
}

/**
 * @deprecated Use `loadFunctions` instead, with `onSkip` to collect the files
 * it skipped. Will be removed in a future release.
 */
export async function loadFunctionsWithDiagnostics(
    directory: string,
    importModule: ModuleImporter = nativeDynamicImport
): Promise<LoadedFunctions> {
    warnDeprecated(
        "server.loadFunctionsWithDiagnostics",
        "`loadFunctionsWithDiagnostics` is deprecated; use `loadFunctions(dir, { onSkip })`, which returns `{ [name]: app }`."
    );
    const { functions, problems } = await readFunctionsDirectory(directory, importModule);
    return { functions: functionList(functions), problems };
}

/**
 * Read a directory of function files: what loaded, keyed by name, and one
 * `<file> (<reason>)` per file that did not.
 *
 * Never throws: a single malformed function must not crash server boot. The
 * backend mounts the router regardless and surfaces the count of skipped files
 * on the listing endpoint.
 */
export async function readFunctionsDirectory(
    directory: string,
    importModule: ModuleImporter = nativeDynamicImport
): Promise<{ functions: FunctionsRecord; problems: string[] }> {
    const functions: FunctionsRecord = {};
    // Aggregate problem files so a broken function surfaces as one loud
    // summary line, not just a warning buried per-file. We still don't throw:
    // a single malformed function must not crash server boot.
    const problems: string[] = [];

    if (!fs.existsSync(directory)) {
        return { functions, problems };
    }

    // `withFileTypes` so a directory entry is a *reported* skip rather than a
    // filter miss. `readdirSync(dir)` returned bare names, and a subdirectory
    // simply failed the `.ts`/`.js` test — so `functions/admin/users.ts` was
    // compiled by `rebase build`, shipped in the bundle, and then dropped at
    // boot without a single log line.
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
        const file = entry.name;

        if (entry.isDirectory()) {
            // Dot-directories are tooling (`.git`, `.turbo`), not intent.
            if (file.startsWith(".") || file === "node_modules") continue;
            logger.warn(
                `[functions] ${file}/: subdirectory ignored. Functions are loaded from the top level of ` +
                `${directory} only, so nothing under ${file}/ is served. Move the file up (or flatten the ` +
                "name: `admin/users.ts` → `admin-users.ts`)."
            );
            problems.push(`${file}/ (subdirectory — functions are not loaded recursively)`);
            continue;
        }

        const extension = path.extname(file);
        if (
            !file.startsWith(".") &&
            !file.includes(".test.") &&
            UNSUPPORTED_CODE_EXTENSIONS.includes(extension)
        ) {
            logger.warn(
                `[functions] ${file}: ${extension} files are not loaded. Rename it to .ts (or .js) to serve it.`
            );
            problems.push(`${file} (unsupported extension ${extension})`);
            continue;
        }

        if (
            (file.endsWith(".ts") || file.endsWith(".js")) &&
            // Dotfiles: notably macOS bsdtar AppleDouble sidecars (`._foo.ts`),
            // binary blobs that cannot be imported.
            !file.startsWith(".") &&
            !file.includes(".test.") &&
            !file.endsWith(".d.ts") &&
            file !== "index.ts" &&
            file !== "index.js"
        ) {
            const filePath = path.join(directory, file);
            try {
                const fileUrl = pathToFileURL(filePath).href;

                const mod = await importModule(fileUrl);

                const exported = mod.default;

                if (!exported) {
                    logger.warn(`[functions] ${file}: no default export. Skipping.`);
                    problems.push(`${file} (no default export)`);
                    continue;
                }

                // Accept a Hono instance — use duck-typing to handle different
                // Hono versions which may not share the same prototype.
                const app = isHonoLike(exported)
                    ? exported as FunctionApp
                    // Also accept a factory function that returns a Hono instance
                    : typeof exported === "function" ? exported() : undefined;
                if (isHonoLike(app)) {
                    const name = path.basename(file, path.extname(file));
                    // `send.ts` and `send.js` side by side name one URL. A
                    // record holds one app per name, so the second is reported
                    // rather than silently replacing the first.
                    if (Object.hasOwn(functions, name)) {
                        logger.warn(`[functions] ${file}: another file is already served as '${name}'. Skipping.`);
                        problems.push(`${file} (another file is already served as '${name}')`);
                        continue;
                    }
                    functions[name] = app as FunctionApp;
                    logger.debug(`⚡ Loaded function route: ${name}`);
                    continue;
                }

                // Provide actionable diagnostics
                const exportType = typeof exported;
                const keys = exported && typeof exported === "object"
                    ? Object.getOwnPropertyNames(Object.getPrototypeOf(exported)).slice(0, 10).join(", ")
                    : "N/A";
                logger.warn(
                    `[functions] ${file}: default export is not a Hono app or factory. Skipping.\n` +
                    `  export type: ${exportType}${exported?.constructor?.name ? ` (${exported.constructor.name})` : ""}\n` +
                    `  prototype methods: ${keys}\n` +
                    "  Hint: ensure the function exports a Hono app created with the same hono version as the server.\n" +
                    "  Author with `defineFunction(...)` from @rebasepro/server for a typed, checked contract.\n" +
                    "  The loader checks for .fetch() and .routes — any Hono-compatible app will work."
                );
                problems.push(`${file} (not a Hono app or factory)`);
            } catch (err: unknown) {
                const message =
                    err instanceof Error ? err.message : String(err);
                logger.error(`[functions] Failed to load ${file}: ${message}`);
                problems.push(describeLoadFailure(file, err));
            }
        }
    }

    if (problems.length > 0) {
        // Advice keyed to what actually went wrong. The old line said
        // "author them with `defineFunction(...)`" for every failure — which is
        // the fix for a wrong export shape and no help at all for the commonest
        // one: a file that threw while being imported, usually a module-scope
        // `process.env.X` read that came back undefined. Told to reach for
        // `defineFunction`, an author rewrites a file whose export was already
        // correct and gets the same failure.
        const advice: string[] = [];
        if (problems.some(p => p.includes("(syntax error"))) {
            advice.push(SYNTAX_ERROR_ADVICE);
        }
        if (problems.some(p => p.includes("(threw:"))) {
            advice.push(
                "  A file that threw ran at import time. Read configuration *inside* a handler " +
                "(`requireEnv(c, \"STRIPE_KEY\")`, or a lazily-built client) rather than at module " +
                "scope, where one undefined variable takes the whole file down before any route exists."
            );
        }
        if (problems.some(p => p.includes("(no default export)"))) {
            advice.push(
                "  A file with no default export exports nothing the loader can mount. " +
                "`export default defineFunction((app) => { … })`."
            );
        }
        if (problems.some(p => p.includes("(not a Hono app or factory)"))) {
            advice.push(
                "  A default export the loader did not recognise is usually two copies of hono. " +
                "Author with `defineFunction(...)` from @rebasepro/server/functions, which uses the " +
                "server's own copy."
            );
        }
        logger.warn(
            `[functions] ${problems.length} function file(s) were skipped and will NOT be served:\n` +
            problems.map((p) => `  - ${p}`).join("\n") + "\n" +
            advice.join("\n")
        );
    }

    return { functions, problems };
}

/**
 * Duck-type check for Hono apps.
 * We avoid `instanceof Hono` because different Hono versions
 * installed in the user's project vs. our dependencies will
 * not share the same prototype, causing false negatives.
 */
function isHonoLike(obj: unknown): boolean {
    if (!obj || typeof obj !== "object") return false;
    // Hono instances always have .fetch() and .routes
    const record = obj as Record<string, unknown>;
    return (
        typeof record.fetch === "function" &&
        Array.isArray(record.routes)
    );
}
