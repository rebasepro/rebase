import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { declareCron, type CronJobDefinition, type CronResourceOptions } from "@rebasepro/types";
import { logger } from "../utils/logger.js";
import { nativeDynamicImport, type ModuleImporter } from "../utils/dynamic-import.js";

export interface LoadedCronJob {
    /** Job ID derived from filename (e.g. "cleanup-sessions"). */
    id: string;
    /** The full definition. */
    definition: CronJobDefinition;
}

/** {@link loadCronJobsWithDiagnostics}' answer: what loaded, and what did not. */
export interface LoadedCronJobs {
    jobs: LoadedCronJob[];
    /** One entry per file that will NOT be scheduled, with the reason. */
    problems: string[];
}

/**
 * Auto-discover cron job files from a directory.
 *
 * Each file should default-export a `CronJobDefinition`.
 * The filename (without extension) becomes the job ID:
 *   `crons/cleanup-sessions.ts` → id = "cleanup-sessions"
 *
 * Follows the same discovery pattern as `loadFunctionsFromDirectory` — see
 * {@link loadCronJobsWithDiagnostics} for what happens to the files it cannot
 * load.
 */
export async function loadCronJobsFromDirectory(
    directory: string,
    importModule: ModuleImporter = nativeDynamicImport
): Promise<LoadedCronJob[]> {
    return (await loadCronJobsWithDiagnostics(directory, importModule)).jobs;
}

/**
 * {@link loadCronJobsFromDirectory}, plus the list of files that were skipped.
 *
 * A job that does not load does not run, and until now the only trace was one
 * `warn` per file in the boot log — next to nothing at 3am when the report that
 * should have been mailed was not. A cron file is written once and then trusted
 * for months, so "it silently never ran" is the failure mode this surface has,
 * and a log line is not a surface.
 *
 * Never throws, for the same reason `loadFunctionsWithDiagnostics` does not: one
 * malformed file must not take the server down, and the other jobs in the
 * directory are still worth scheduling. The difference is that the skips are now
 * counted, summarised in one place, and answered by `GET /api/cron` — so the
 * question "why did nothing run?" has an answer that does not require log
 * access.
 */
export async function loadCronJobsWithDiagnostics(
    directory: string,
    importModule: ModuleImporter = nativeDynamicImport
): Promise<LoadedCronJobs> {
    const jobs: LoadedCronJob[] = [];
    // Aggregated so a broken job surfaces as one loud summary rather than a
    // warning buried per-file among the boot noise.
    const problems: string[] = [];

    if (!fs.existsSync(directory)) {
        return { jobs, problems };
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
                    problems.push(`${file} (no default export)`);
                    logger.warn(`[cron] ${file}: no valid default export. Skipping.`);
                    continue;
                }

                const def = exported as Record<string, unknown>;
                if (typeof def.schedule !== "string" || typeof def.handler !== "function") {
                    problems.push(`${file} (default export has no 'schedule' or no 'handler')`);
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

                // The declaration, keyed by the same id the scheduler, the
                // routes and the Studio use — the filename. `defineCron` cannot
                // do this: it never sees the filename, and `name` is a label.
                // The derive step runs this same loader, so the graph a host
                // reads and the schedule this process runs come from one place.
                // From the raw export, not the normalised definition: the
                // defaults filled in above (`enabled: true`, `timeoutSeconds:
                // 300`) are this process's, and a graph that records them for
                // every cron would say something the author never wrote.
                declareCron(id, cronResourceOptions(def as unknown as CronJobDefinition));

                jobs.push({ id,
definition });
                logger.info(
                    `⏰ Loaded cron job: ${id} (${definition.schedule}` +
                    `${definition.timezone ? ` ${definition.timezone}` : " in the process's local time"})`
                );
            } catch (err: unknown) {
                const message =
                    err instanceof Error ? err.message : String(err);
                problems.push(`${file} (threw: ${message})`);
                logger.error(`[cron] Failed to load ${file}: ${message}`);
            }
        }
    }

    if (problems.length > 0) {
        logger.warn(
            `[cron] ${problems.length} cron file(s) were skipped and will NOT be scheduled:\n` +
            problems.map((p) => `  - ${p}`).join("\n") + "\n" +
            "  Fix these or author them with `defineCron(...)` for a typed, compile-checked contract."
        );
    }

    return { jobs, problems };
}

/**
 * The declaration a definition makes: every field a host can read without the
 * handler. Spelled once here so the graph and the scheduler cannot disagree
 * about what a cron is.
 */
export function cronResourceOptions(definition: CronJobDefinition): CronResourceOptions {
    return {
        schedule: definition.schedule,
        ...(definition.timezone !== undefined ? { timezone: definition.timezone } : {}),
        ...(definition.description !== undefined ? { description: definition.description } : {}),
        ...(definition.enabled !== undefined ? { enabled: definition.enabled } : {}),
        ...(definition.timeoutSeconds !== undefined ? { timeoutSeconds: definition.timeoutSeconds } : {}),
        ...(definition.catchUpWindowSeconds !== undefined ? { catchUpWindowSeconds: definition.catchUpWindowSeconds } : {}),
        ...(definition.name ? { label: definition.name } : {})
    };
}
