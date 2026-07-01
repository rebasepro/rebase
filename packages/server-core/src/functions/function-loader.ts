import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { Hono } from "hono";
import { logger } from "../utils/logger.js";

export interface LoadedFunction {
    /** Endpoint name derived from filename (e.g., "send-invoice") */
    name: string;
    /** The Hono sub-app to mount */
    app: Hono<import("hono").Env>;
}

/**
 * Auto-discover Hono route files from a directory.
 *
 * Each file should default-export a Hono app (or router).
 * The filename (without extension) becomes the mount path:
 *   `functions/send-invoice.ts` → mounted at `/send-invoice`
 *
 * This mirrors how `loadCollectionsFromDirectory` works for collections.
 */
export async function loadFunctionsFromDirectory(
    directory: string
): Promise<LoadedFunction[]> {
    const functions: LoadedFunction[] = [];
    // Aggregate problem files so a broken function surfaces as one loud
    // summary line, not just a warning buried per-file. We still don't throw:
    // a single malformed function must not crash server boot.
    const problems: string[] = [];

    if (!fs.existsSync(directory)) {
        return functions;
    }

    const files = fs.readdirSync(directory);
    for (const file of files) {
        if (
            (file.endsWith(".ts") || file.endsWith(".js")) &&
            !file.includes(".test.") &&
            !file.endsWith(".d.ts") &&
            file !== "index.ts" &&
            file !== "index.js"
        ) {
            const filePath = path.join(directory, file);
            try {
                const fileUrl = pathToFileURL(filePath).href;

                // Use new Function to compile dynamic import natively and bypass
                // tsc converting import() to require() — same pattern as collection loader
                const dynamicImport = new Function("url", "return import(url)");
                const mod = await dynamicImport(fileUrl);

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
                    logger.info(`⚡ Loaded function route: ${name}`);
                    continue;
                }

                // Also accept a factory function that returns a Hono instance
                if (typeof exported === "function") {
                    const result = exported();
                    if (isHonoLike(result)) {
                        const name = path.basename(file, path.extname(file));
                        functions.push({ name,
app: result as Hono });
                        logger.info(`⚡ Loaded function route: ${name}`);
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
                    "  Author with `defineFunction(...)` from @rebasepro/server-core for a typed, checked contract.\n" +
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

    return functions;
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
