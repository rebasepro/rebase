/**
 * The scheduled orphan sweep a bucket declares with `orphanSweep`.
 *
 * Deleting a row leaves its files behind, on purpose: a key is not owned by one
 * row (another row, a version in row history, or app code holding it in a plain
 * string may still name it), so deleting with the row would break whichever of
 * those exists. What was missing is the clean-up that can see all of them —
 * `rebase storage orphans --delete`, which somebody had to remember to run.
 *
 * This is that, on a schedule. Each sweep is the same two calls the admin route
 * makes: `findOrphans` reads every row and history entry, and keeps a file
 * still named anywhere or newer than the grace period; `deleteScannedOrphans`
 * reads them again and checks each file right before deleting it. A collection
 * either pass cannot read keeps everything for that run.
 *
 * It is a cron job rather than a timer of its own so it gets what crons already
 * have: one instance per slot (`rebase.cron_claims`), a run history with the
 * result, a timeout that aborts the scan, and a place in the admin's cron list
 * where it can be paused or run by hand.
 */
import type { CronJobContext, StorageSourceDefinition } from "@rebasepro/types";
import { DEFAULT_STORAGE_SOURCE_KEY } from "@rebasepro/types";

import type { LoadedCronJob } from "../cron/cron-loader";
import { deleteScannedOrphans, findOrphans, type ReferenceSources } from "./maintenance";
import type { StorageController } from "./types";
import type { StorageRegistry } from "./storage-registry";

/** Daily, at a minute nothing else in the platform picks. */
export const DEFAULT_ORPHAN_SWEEP_SCHEDULE = "17 4 * * *";
/** A week: long enough to notice a mistake in app code before its files go. */
export const DEFAULT_ORPHAN_SWEEP_HOURS = 168;
/** An upload is written before the row naming it is saved; a day covers any form left open. */
export const MIN_ORPHAN_SWEEP_HOURS = 24;

/** The job's id: `storage-orphan-sweep-media`, and `-default` for the default source. */
export function orphanSweepJobId(sourceKey: string): string {
    const name = sourceKey === DEFAULT_STORAGE_SOURCE_KEY
        ? "default"
        : sourceKey.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return `storage-orphan-sweep-${name || "default"}`;
}

/** Where the sweep reads its files and references from. */
export interface OrphanSweepDeps extends Omit<ReferenceSources, "tables" | "globalHooks"> {
    registry?: StorageRegistry;
    controller?: StorageController;
    /** The tables whose rows are read for references, read when a sweep runs. */
    tables: () => ReferenceSources["tables"];
    /** The global table hooks, read when a sweep runs. */
    globalHooks?: () => ReferenceSources["globalHooks"];
    now?: () => number;
}

/** What one sweep did, as the run history keeps it. */
export interface OrphanSweepResult {
    storageId: string;
    olderThanHours: number;
    objects: number;
    deleted: number;
    /** Unreferenced but inside the grace period, or of unknown age. */
    recent: number;
    kept: number;
    failed: { key: string; error: string }[];
    /** Collections that could not be read. When any is, nothing was deleted. */
    unscanned: string[];
}

/**
 * One cron job per source that declares a sweep, and a sentence for each that
 * declares one this cannot run.
 */
export function orphanSweepJobs(
    sources: readonly StorageSourceDefinition[],
    deps: OrphanSweepDeps
): { jobs: LoadedCronJob[]; problems: string[] } {
    const jobs: LoadedCronJob[] = [];
    const problems: string[] = [];
    for (const source of sources) {
        if (!source.orphanSweep) continue;
        const olderThanHours = source.orphanSweep.olderThanHours ?? DEFAULT_ORPHAN_SWEEP_HOURS;
        if (!Number.isFinite(olderThanHours) || olderThanHours < MIN_ORPHAN_SWEEP_HOURS) {
            problems.push(
                `bucket("${source.key}") sets orphanSweep.olderThanHours to ${olderThanHours}; it must be at least ` +
                `${MIN_ORPHAN_SWEEP_HOURS}, because an upload is written before the row that names it. ` +
                "No sweep is scheduled for it."
            );
            continue;
        }
        if (source.transport === "direct") {
            problems.push(
                `bucket("${source.key}") sets orphanSweep, but its transport is "direct": this backend never ` +
                "reaches that bucket, so it cannot sweep it. No sweep is scheduled for it."
            );
            continue;
        }
        jobs.push({
            id: orphanSweepJobId(source.key),
            definition: {
                schedule: source.orphanSweep.schedule ?? DEFAULT_ORPHAN_SWEEP_SCHEDULE,
                timezone: "UTC",
                name: `Sweep unreferenced files from ${source.key === DEFAULT_STORAGE_SOURCE_KEY ? "the default bucket" : `"${source.key}"`}`,
                description: `Deletes files in "${source.key}" that no row or history entry names and that are older ` +
                    `than ${olderThanHours} hours. Declared with bucket(…, { orphanSweep }).`,
                // A scan reads every row of every collection; a day's worth of
                // rows can take a while, and a slot missed is caught up once.
                timeoutSeconds: 3600,
                catchUpWindowSeconds: 6 * 3600,
                handler: (ctx: CronJobContext) => runOrphanSweep(source.key, olderThanHours, deps, ctx)
            }
        });
    }
    return { jobs, problems };
}

/** One sweep of one source. Exported for tests. */
export async function runOrphanSweep(
    storageId: string,
    olderThanHours: number,
    deps: OrphanSweepDeps,
    ctx: Pick<CronJobContext, "log" | "signal">
): Promise<OrphanSweepResult> {
    const controller = deps.registry
        ? deps.registry.get(storageId)
        : storageId === DEFAULT_STORAGE_SOURCE_KEY ? deps.controller : undefined;
    if (!controller) {
        // Thrown, so the run is recorded as failed: a sweep that silently found
        // nothing to sweep is how a misconfigured bucket fills up unnoticed.
        throw new Error(`Storage source "${storageId}" is not configured on this backend, so it cannot be swept.`);
    }

    const sources: ReferenceSources = {
        tables: deps.tables(),
        driverFor: deps.driverFor,
        driverCollection: deps.driverCollection,
        globalHooks: deps.globalHooks?.(),
        history: deps.history
    };
    const olderThanMs = olderThanHours * 3_600_000;
    const now = deps.now ?? Date.now;

    const report = await findOrphans({ ...sources, controller, olderThanMs, now: now(), signal: ctx.signal });
    const result: OrphanSweepResult = {
        storageId,
        olderThanHours,
        objects: report.objects,
        deleted: 0,
        recent: report.recent,
        kept: 0,
        failed: [],
        unscanned: report.unscanned.map(u => `${u.collection}: ${u.reason}`)
    };
    if (report.unscanned.length > 0) {
        ctx.log(`Kept every file: ${report.unscanned.length} collection(s) could not be read (${result.unscanned.join("; ")}).`);
        return result;
    }
    if (report.orphans.length === 0) {
        ctx.log(`Nothing to sweep: ${report.objects} file(s), none unreferenced for ${olderThanHours} hours.`);
        return result;
    }

    const deletion = await deleteScannedOrphans({
        ...sources,
        controller,
        candidates: report.orphans,
        olderThanMs,
        now,
        signal: ctx.signal
    });
    result.deleted = deletion.deleted.length;
    result.kept = deletion.kept.length;
    result.failed = deletion.failed;
    result.unscanned = deletion.unscanned.map(u => `${u.collection}: ${u.reason}`);
    ctx.log(
        `Deleted ${result.deleted} unreferenced file(s) from "${storageId}"` +
        (result.kept ? `, kept ${result.kept} that changed since the scan` : "") +
        (result.failed.length ? `, ${result.failed.length} failed` : "") +
        "."
    );
    return result;
}
