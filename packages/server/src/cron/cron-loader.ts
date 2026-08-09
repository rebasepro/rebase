import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import type { CronJobDefinition } from "@rebasepro/types";
import { logger } from "../utils/logger.js";
import { nativeDynamicImport, type ModuleImporter } from "../utils/dynamic-import.js";

export interface LoadedCronJob {
    /** Job ID derived from filename (e.g. "cleanup-sessions"). */
    id: string;
    /** The full definition. */
    definition: CronJobDefinition;
}

/**
 * Auto-discover cron job files from a directory.
 *
 * Each file should default-export a `CronJobDefinition`.
 * The filename (without extension) becomes the job ID:
 *   `crons/cleanup-sessions.ts` → id = "cleanup-sessions"
 *
 * Follows the same discovery pattern as `loadFunctionsFromDirectory`.
 */
export async function loadCronJobsFromDirectory(
    directory: string,
    importModule: ModuleImporter = nativeDynamicImport
): Promise<LoadedCronJob[]> {
    const jobs: LoadedCronJob[] = [];

    if (!fs.existsSync(directory)) {
        return jobs;
    }

    const files = fs.readdirSync(directory);
    for (const file of files) {
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

                const exported: unknown = mod.default;

                if (!exported || typeof exported !== "object") {
                    logger.warn(`[cron] ${file}: no valid default export. Skipping.`);
                    continue;
                }

                const def = exported as Record<string, unknown>;
                if (typeof def.schedule !== "string" || typeof def.handler !== "function") {
                    logger.warn(`[cron] ${file}: default export missing required 'schedule' or 'handler'. Skipping.`);
                    continue;
                }

                const id = path.basename(file, path.extname(file));
                // Spread first, then normalise. Rebuilding this object field by
                // field dropped `catchUpWindowSeconds` — and since this loader
                // is the only production caller of `registerJobs`, catch-up
                // never ran for any job authored the documented way: 64 lines
                // of docblock, a docs section, a unit suite and a Postgres e2e
                // all describing a feature that was switched off in the one
                // path that matters. Every existing test built `LoadedCronJob`
                // literals directly, so none of them went through here.
                //
                // The shape is the bug, not the missing line: a field added to
                // `CronJobDefinition` tomorrow would be dropped the same way.
                const definition: CronJobDefinition = {
                    ...(def as Partial<CronJobDefinition>),
                    schedule: def.schedule as string,
                    name: (def.name as string) || id,
                    enabled: def.enabled !== false,
                    timeoutSeconds: (def.timeoutSeconds as number) || 300,
                    handler: def.handler as CronJobDefinition["handler"]
                };

                jobs.push({ id,
definition });
                logger.info(`⏰ Loaded cron job: ${id} (${definition.schedule})`);
            } catch (err: unknown) {
                const message =
                    err instanceof Error ? err.message : String(err);
                logger.error(`[cron] Failed to load ${file}: ${message}`);
            }
        }
    }

    return jobs;
}
