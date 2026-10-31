import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { declareCron, type CronJobDefinition, type CronResourceOptions } from "@rebasepro/types";
import { logger } from "../utils/logger.js";
import { nativeDynamicImport, type ModuleImporter } from "../utils/dynamic-import.js";
import { describeLoadFailure, SYNTAX_ERROR_ADVICE } from "../utils/load-failure.js";
import { warnDeprecated } from "@rebasepro/common";
import type { LoadDirectoryOptions } from "../functions/function-loader.js";

/**
 * Cron jobs as values: the job id, to its definition.
 *
 * `crons: { "nightly-report": nightlyReport }` schedules `nightlyReport` as the
 * job `nightly-report` — the same thing a file named `crons/nightly-report.ts`
 * does. {@link loadCrons} returns exactly this shape, so
 * `crons: await loadCrons(dir)` and `cronsDir: dir` schedule the same jobs.
 *
 * A value is what the author wrote — `defineCron({...})` — with no defaults
 * filled in. The scheduler fills them in when it registers the job.
 */
export type CronsRecord = Record<string, CronJobDefinition>;

/** A job as the scheduler registers it: its id, and its definition with defaults filled in. */
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
 * Load the cron jobs in a directory, as values.
 *
 * Each file default-exports a `CronJobDefinition` — `defineCron({...})`. The
 * filename without its extension is the record key, which is the job id:
 * `crons/cleanup-sessions.ts` → `{ "cleanup-sessions": definition }`.
 *
 * Loading declares nothing: the definitions come back exactly as written, and
 * whoever uses them decides what they are for — a backend schedules them, the
 * build's derive step records them in the resource graph ({@link declareCrons}).
 *
 * Never throws for a bad file: it is skipped, logged, and passed to
 * `options.onSkip`.
 *
 * @example
 * ```ts
 * const crons = await loadCrons(path.resolve("crons"));
 * const backend = await createRebaseBackend({ database, crons, provision: true });
 * ```
 */
export async function loadCrons(directory: string, options: LoadDirectoryOptions = {}): Promise<CronsRecord> {
    const { crons, problems } = await readCronsDirectory(directory, options.importModule);
    if (options.onSkip) for (const problem of problems) options.onSkip(problem);
    return crons;
}

/**
 * Record each cron in the project's resource graph — what `rebase resources`
 * lists and a host reads to know a schedule exists, without running it.
 *
 * Keyed by the same id the scheduler, the routes and the Studio use, and built
 * from the definitions as written: a default the scheduler fills in
 * (`enabled: true`, `timeoutSeconds: 300`) is this process's, not something the
 * author declared.
 */
export function declareCrons(crons: CronsRecord): void {
    for (const [id, definition] of Object.entries(crons)) {
        declareCron(id, cronResourceOptions(definition));
    }
}

/**
 * The jobs a scheduler registers, from cron values: the definitions with this
 * process's defaults filled in.
 *
 * Spread first, then normalise. Rebuilding the object field by field dropped
 * `catchUpWindowSeconds` once — and since this is the path every job takes to
 * the scheduler, catch-up never ran for any job authored the documented way. A
 * field added to `CronJobDefinition` tomorrow would be dropped the same way.
 *
 * @throws when a value has no `schedule` or no `handler`. A file like that is
 * skipped by the loader with a reason; a value handed over in code is refused,
 * because the caller is right there to fix it.
 */
export function cronJobsFrom(crons: CronsRecord): LoadedCronJob[] {
    return Object.entries(crons).map(([id, definition]) => {
        const def = definition as Partial<CronJobDefinition> | undefined;
        if (!def || typeof def.schedule !== "string" || typeof def.handler !== "function") {
            throw new Error(
                `crons["${id}"] is not a cron job: it needs a \`schedule\` string and a \`handler\` function. ` +
                "Author it with `defineCron({ schedule, handler })`."
            );
        }
        return {
            id,
            definition: {
                ...def,
                schedule: def.schedule,
                name: def.name || id,
                enabled: def.enabled !== false,
                // `??`, not `||`: zero and NaN are values the author wrote, and
                // the scheduler refuses both by name (they end up under
                // `rejected`). `|| 300` swallowed them, so a job written with
                // `0` meaning "no limit" ran with five minutes and was listed as
                // healthy. `Infinity` is "none".
                timeoutSeconds: def.timeoutSeconds ?? 300,
                handler: def.handler
            }
        };
    });
}

/**
 * @deprecated Use `loadCrons` instead, which returns the jobs as a record keyed
 * by id. Will be removed in a future release.
 */
export async function loadCronJobsFromDirectory(
    directory: string,
    importModule: ModuleImporter = nativeDynamicImport
): Promise<LoadedCronJob[]> {
    warnDeprecated(
        "server.loadCronJobsFromDirectory",
        "`loadCronJobsFromDirectory` is deprecated; use `loadCrons(dir)`, which returns `{ [id]: definition }`."
    );
    return (await legacyLoad(directory, importModule)).jobs;
}

/**
 * @deprecated Use `loadCrons` instead, with `onSkip` to collect the files it
 * skipped — and `declareCrons` where the jobs belong in the resource graph,
 * which this used to do as a side effect of loading. Will be removed in a
 * future release.
 */
export async function loadCronJobsWithDiagnostics(
    directory: string,
    importModule: ModuleImporter = nativeDynamicImport
): Promise<LoadedCronJobs> {
    warnDeprecated(
        "server.loadCronJobsWithDiagnostics",
        "`loadCronJobsWithDiagnostics` is deprecated; use `loadCrons(dir, { onSkip })`, which returns " +
        "`{ [id]: definition }`, and `declareCrons(crons)` to record them in the resource graph."
    );
    return legacyLoad(directory, importModule);
}

/**
 * What the deprecated loaders did: load, declare every job in the resource
 * graph, and hand back normalised jobs. A job the graph refuses is skipped as a
 * problem, as it was when the declaration ran inside the loader.
 */
async function legacyLoad(directory: string, importModule: ModuleImporter): Promise<LoadedCronJobs> {
    const { crons, problems } = await readCronsDirectory(directory, importModule);
    const declared: CronsRecord = {};
    for (const [id, definition] of Object.entries(crons)) {
        try {
            declareCron(id, cronResourceOptions(definition));
            declared[id] = definition;
        } catch (err) {
            problems.push(describeLoadFailure(id, err));
        }
    }
    return { jobs: cronJobsFrom(declared), problems };
}

/**
 * Read a directory of cron files: the definitions that loaded, keyed by id, and
 * one `<file> (<reason>)` per file that will NOT be scheduled.
 *
 * A job that does not load does not run, and the only trace used to be one
 * `warn` per file in the boot log — next to nothing at 3am when the report that
 * should have been mailed was not. So the skips are counted, summarised in one
 * place, and answered by `GET /api/admin/cron`.
 *
 * Never throws, for the same reason the function loader does not: one
 * malformed file must not take the server down, and the other jobs in the
 * directory are still worth scheduling.
 *
 * `failed` is the part of `problems` that threw or did not parse: the rest are
 * files with no job in them, as `readFunctionsDirectory` has it.
 */
export async function readCronsDirectory(
    directory: string,
    importModule: ModuleImporter = nativeDynamicImport
): Promise<{ crons: CronsRecord; problems: string[]; failed: string[] }> {
    const crons: CronsRecord = {};
    // Aggregated so a broken job surfaces as one loud summary rather than a
    // warning buried per-file among the boot noise.
    const problems: string[] = [];
    const failed: string[] = [];

    if (!fs.existsSync(directory)) {
        return { crons, problems, failed };
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
                if (typeof def.schedule !== "string" || def.schedule.trim() === "" || typeof def.handler !== "function") {
                    problems.push(`${file} (default export has no 'schedule' or no 'handler')`);
                    logger.warn(`[cron] ${file}: default export missing required 'schedule' or 'handler'. Skipping.`);
                    continue;
                }

                const id = path.basename(file, path.extname(file));
                const definition = exported as CronJobDefinition;
                crons[id] = definition;
                logger.info(
                    `⏰ Loaded cron job: ${id} (${definition.schedule}` +
                    `${definition.timezone ? ` ${definition.timezone}` : " in the process's local time"})`
                );
            } catch (err: unknown) {
                const message =
                    err instanceof Error ? err.message : String(err);
                const failure = describeLoadFailure(file, err);
                problems.push(failure);
                failed.push(failure);
                // At `debug`: the aggregate warning below lists every problem
                // by file, so this line was the same text a second time — and
                // when the throw is a Zod error, that text is ten lines of
                // serialised issues. The reader met it twice before reaching
                // the sentence that says what to do.
                logger.debug(`[cron] Failed to load ${file}: ${message}`);
            }
        }
    }

    if (problems.length > 0) {
        // Advice keyed to what went wrong, as the functions loader does:
        // `defineCron` is the remedy for a wrong export shape, not for a typo.
        const syntax = problems.some(p => p.includes("(syntax error"));
        const other = problems.some(p => !p.includes("(syntax error"));
        logger.warn(
            `[cron] ${problems.length} cron file(s) were skipped and will NOT be scheduled:\n` +
            problems.map((p) => `  - ${p}`).join("\n") + "\n" +
            [
                ...(syntax ? [SYNTAX_ERROR_ADVICE] : []),
                ...(other ? ["  Fix these or author them with `defineCron(...)` for a typed, compile-checked contract."] : [])
            ].join("\n")
        );
    }

    return { crons, problems, failed };
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
