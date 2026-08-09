import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { Hono } from "hono";
import { logger } from "../utils/logger.js";
import { nativeDynamicImport, type ModuleImporter } from "../utils/dynamic-import.js";

export interface LoadedFunction {
    /** Endpoint name derived from filename (e.g., "send-invoice") */
    name: string;
    /** The Hono sub-app to mount */
    app: Hono<import("hono").Env>;
}

/** What a directory of function files produced: what mounted, and what did not. */
export interface LoadedFunctions {
    /** The functions that will be served. */
    functions: LoadedFunction[];
    /**
     * One entry per file the loader saw and did **not** mount, each already
     * phrased as `<name> (<reason>)`. Returned rather than only logged so the
     * running server can say what is missing — a boot log line is not reachable
     * from `GET /api/functions`.
     */
    problems: string[];
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
 * Auto-discover Hono route files from a directory.
 *
 * Each file should default-export a Hono app (or router).
 * The filename (without extension) becomes the mount path:
 *   `functions/send-invoice.ts` → mounted at `/send-invoice`
 *
 * This mirrors how `loadCollectionsFromDirectory` works for collections.
 *
 * Returns only what loaded. Use {@link loadFunctionsWithDiagnostics} when the
 * caller also needs to report what did not.
 */
export async function loadFunctionsFromDirectory(
    directory: string,
    importModule: ModuleImporter = nativeDynamicImport
): Promise<LoadedFunction[]> {
    return (await loadFunctionsWithDiagnostics(directory, importModule)).functions;
}

/**
 * {@link loadFunctionsFromDirectory}, plus the list of files that were skipped.
 *
 * Never throws: a single malformed function must not crash server boot. The
 * caller decides what to do with `problems` — `init.ts` mounts the router
 * regardless and surfaces the count on the listing endpoint.
 */
export async function loadFunctionsWithDiagnostics(
    directory: string,
    importModule: ModuleImporter = nativeDynamicImport
): Promise<LoadedFunctions> {
    const functions: LoadedFunction[] = [];
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
                if (isHonoLike(exported)) {
                    const name = path.basename(file, path.extname(file));
                    functions.push({ name,
app: exported as Hono });
                    logger.debug(`⚡ Loaded function route: ${name}`);
                    continue;
                }

                // Also accept a factory function that returns a Hono instance
                if (typeof exported === "function") {
                    const result = exported();
                    if (isHonoLike(result)) {
                        const name = path.basename(file, path.extname(file));
                        functions.push({ name,
app: result as Hono });
                        logger.debug(`⚡ Loaded function route: ${name}`);
                        continue;
                    }
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
                problems.push(`${file} (threw: ${message})`);
            }
        }
    }

    if (problems.length > 0) {
        logger.warn(
            `[functions] ${problems.length} function file(s) were skipped and will NOT be served:\n` +
            problems.map((p) => `  - ${p}`).join("\n") + "\n" +
            "  Fix these or author them with `defineFunction(...)` for a typed, compile-checked contract."
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
