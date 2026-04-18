import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { Hono } from "hono";

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
                    console.warn(
                        `[functions] ${file}: no default export. Skipping.`
                    );
                    continue;
                }

                // Accept a Hono instance directly
                if (exported instanceof Hono) {
                    const name = path.basename(file, path.extname(file));
                    functions.push({ name, app: exported });
                    console.log(`⚡ Loaded function route: ${name}`);
                    continue;
                }

                // Also accept a factory function that returns a Hono instance
                if (typeof exported === "function") {
                    const result = exported();
                    if (result instanceof Hono) {
                        const name = path.basename(file, path.extname(file));
                        functions.push({ name, app: result });
                        console.log(`⚡ Loaded function route: ${name}`);
                        continue;
                    }
                }

                console.warn(
                    `[functions] ${file}: default export is not a Hono app or factory. Skipping.`
                );
            } catch (err: unknown) {
                const message =
                    err instanceof Error ? err.message : String(err);
                console.error(
                    `[functions] Failed to load ${file}: ${message}`
                );
            }
        }
    }

    return functions;
}
