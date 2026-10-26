/**
 * The orphan scan as background work: `rebase storage orphans` on a project
 * too big to scan inside one HTTP request.
 *
 * A scan reads every object of a source and every row of every collection,
 * plus history, before it can call anything unused. On a big project that is
 * minutes, and an ingress in front of the server answers 504 long before. So
 * a scan is started, runs in the background, and is asked about:
 *
 *   start  — writes the scan's record, then enqueues a `storage.orphans` job
 *            on the durable job queue, or — on a backend that runs no job
 *            queue — runs it in this process, in the background, and says so;
 *   status — the record: progress while it runs (files listed, rows read,
 *            collections that could not be read), the report when it is done;
 *   delete — only from a completed scan, recent, that read every collection.
 *            It is background work too: every row and history entry is read
 *            again against the scan's candidates alone, and each file is asked
 *            for again right before it is deleted.
 *
 * The record lives in the scanned source itself, under the reserved
 * `_rebase/maintenance/` folder, so whichever process runs the scan (a worker
 * pod) and whichever answers the status (any api pod) read the same one, on
 * any database driver, with nothing added to the schema.
 */
import { randomUUID } from "crypto";
import type { CollectionCallbacks, CollectionConfig, DataDriver } from "@rebasepro/types";
import { DEFAULT_STORAGE_SOURCE_KEY } from "@rebasepro/types";
import { ApiError } from "../api/errors";
import { logger } from "../utils/logger";
import type { JobQueueClient } from "../jobs/types";
import type { StorageController } from "./types";
import type { StorageRegistry } from "./storage-registry";
import { canonicalStorageId } from "./keys";
import { MAINTENANCE_PREFIX } from "./maintenance-keys";
import {
    deleteScannedOrphans,
    emptyScanProgress,
    findOrphans,
    type OrphanReport,
    type ScanProgress,
    type StoredHistory,
    type UnscannedCollection
} from "./maintenance";

/** The job task a scan, or a scan's delete, runs as. Frozen: workers of another release claim it by name. */
export const STORAGE_ORPHANS_TASK = "storage.orphans";

/** Where scan records are kept inside the scanned source. */
export const ORPHAN_SCAN_FOLDER = `${MAINTENANCE_PREFIX}orphan-scans`;

/**
 * How long after it completed a scan's result may still be deleted from.
 * Every candidate is checked again before it goes, so this is not what keeps
 * a file in use; it keeps a delete acting on what the person just read.
 */
export const ORPHAN_SCAN_TTL_MS = 15 * 60_000;

/**
 * A scan, or a delete, that has written no progress for this long is reported
 * failed: the process running it stopped — a deploy, a crash — and nothing
 * else will finish it. Progress is written at least once a page.
 */
export const ORPHAN_SCAN_STALL_MS = 10 * 60_000;

/** A queued scan nobody has started after this long gets a note saying why that may be. */
const QUEUED_NOTE_AFTER_MS = 60_000;

/** The least time between two writes of a running scan's record. */
const PROGRESS_WRITE_INTERVAL_MS = 2_000;

/** Records older than this are deleted when the next scan of their source starts. */
const RECORD_RETENTION_MS = 7 * 24 * 3_600_000;

/** The default grace period: an upload whose row is not saved yet is a day old at most. */
export const DEFAULT_OLDER_THAN_HOURS = 24;

const SCAN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Who runs a scan: the job queue's workers, or the server process that was asked. */
export type OrphanScanRunner = "worker" | "in-process";

export type OrphanScanStatus = "queued" | "running" | "completed" | "failed";

/** A delete from a completed scan, as its record holds it. */
export interface OrphanScanDeletion {
    status: OrphanScanStatus;
    runner: OrphanScanRunner;
    jobId?: string;
    requestedAt: string;
    startedAt?: string;
    updatedAt: string;
    completedAt?: string;
    progress: ScanProgress & { candidates: number; deleted: number };
    result?: {
        deleted: string[];
        kept: { key: string; reason: string }[];
        failed: { key: string; error: string }[];
    };
    error?: string;
    /** Set on the way out when a running delete has stopped reporting. */
    note?: string;
}

/** A scan's record: what `GET /orphans/scans/:id` answers. */
export interface OrphanScanState {
    id: string;
    storageId: string;
    olderThanHours: number;
    runner: OrphanScanRunner;
    jobId?: string;
    status: OrphanScanStatus;
    createdAt: string;
    startedAt?: string;
    updatedAt: string;
    completedAt?: string;
    progress: ScanProgress;
    /** The report, once completed: what the synchronous `GET /orphans` answered. */
    result?: OrphanReport;
    error?: string;
    /** Said on the way out, never stored: why a queued scan may not have started, or that one stalled. */
    note?: string;
    deletion?: OrphanScanDeletion;
}

/** A `storage.orphans` job's payload. */
export interface OrphanScanTaskPayload {
    scanId: string;
    storageId: string;
    mode: "scan" | "delete";
}

export interface OrphanScanServiceConfig {
    registry?: StorageRegistry;
    controller?: StorageController;
    /** The collections whose rows are read for references, read when a scan runs. */
    collections: () => readonly CollectionConfig[];
    /** The unscoped driver serving a collection. See `StorageMaintenanceRoutesConfig.driverFor`. */
    driverFor: (collection: CollectionConfig) => DataDriver | undefined;
    globalCallbacks?: () => CollectionCallbacks | undefined;
    history?: StoredHistory;
    /**
     * The durable job queue, read when a scan starts: present, the scan is a
     * `storage.orphans` job its workers run; absent, it runs in this process.
     */
    jobs?: () => JobQueueClient | undefined;
    /** For tests. */
    now?: () => number;
}

export interface OrphanScanService {
    /** Record a scan and set it going. Resolves with its record, `queued`. */
    start(options: { storageId?: string; olderThanHours?: number }): Promise<OrphanScanState>;
    /** A scan's record, or `undefined` when this source holds none by that id. */
    status(storageId: string | undefined, id: string): Promise<OrphanScanState | undefined>;
    /** Start deleting a completed scan's orphans. Throws the refusal when it may not. */
    requestDeletion(storageId: string | undefined, id: string): Promise<OrphanScanState>;
    /** Run a `storage.orphans` job: the scan, or its delete. */
    runTask(payload: OrphanScanTaskPayload, signal?: AbortSignal): Promise<void>;
}

/**
 * The storage source a request names, or the 404 that lists the ones served.
 */
export function resolveStorageSource(
    sources: { registry?: StorageRegistry; controller?: StorageController },
    rawId: unknown,
    label: string
): StorageController {
    if (rawId !== undefined && typeof rawId !== "string") {
        throw ApiError.badRequest(`\`${label}\` must be a storage source key.`);
    }
    const id = canonicalStorageId(rawId);
    const controller = sources.registry
        ? sources.registry.get(id)
        : id === DEFAULT_STORAGE_SOURCE_KEY ? sources.controller : undefined;
    if (!controller) {
        const served = sources.registry?.list() ?? (sources.controller ? [DEFAULT_STORAGE_SOURCE_KEY] : []);
        throw new ApiError(
            404,
            "UNKNOWN_STORAGE_SOURCE",
            `This server has no storage source "${id}". It serves ${served.map(key => `"${key}"`).join(", ") || "none"}.`
        );
    }
    return controller;
}

/** `olderThanHours` as a request sends it, checked. */
export function parseOlderThanHours(raw: string | number | undefined): number {
    if (raw === undefined || raw === "") return DEFAULT_OLDER_THAN_HOURS;
    const hours = Number(raw);
    if (!Number.isFinite(hours) || hours < 0) {
        throw ApiError.badRequest("`olderThanHours` must be a number of hours, 0 or more.");
    }
    return hours;
}

const recordKey = (id: string) => `${ORPHAN_SCAN_FOLDER}/${id}.json`;

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Whether a value read back from a source is a scan record. Only shape enough to act on it safely. */
function isScanState(value: unknown, id: string): value is OrphanScanState {
    if (!value || typeof value !== "object") return false;
    const record = value as Partial<OrphanScanState>;
    return record.id === id
        && typeof record.storageId === "string"
        && typeof record.status === "string"
        && typeof record.olderThanHours === "number"
        && !!record.progress && typeof record.progress === "object";
}

/**
 * Writes a running scan's record at most every {@link PROGRESS_WRITE_INTERVAL_MS},
 * one write at a time, in order.
 */
function progressWriter(write: () => Promise<void>, now: () => number) {
    let last = 0;
    let chain: Promise<void> = Promise.resolve();
    const enqueue = () => {
        chain = chain.then(write).catch((error: unknown) => {
            logger.warn("[storage] Could not record an orphan scan's progress", { error });
        });
        return chain;
    };
    return {
        tick(): void {
            if (now() - last < PROGRESS_WRITE_INTERVAL_MS) return;
            last = now();
            void enqueue();
        },
        /** Write now, after any write in flight, and wait for it. */
        async flush(): Promise<void> {
            last = now();
            await enqueue();
        }
    };
}

export function createOrphanScanService(config: OrphanScanServiceConfig): OrphanScanService {
    const now = config.now ?? Date.now;
    const iso = () => new Date(now()).toISOString();
    const sourceOf = (rawId: unknown) => resolveStorageSource(config, rawId, "storageId");

    async function read(controller: StorageController, id: string): Promise<OrphanScanState | undefined> {
        if (!SCAN_ID.test(id)) return undefined;
        const file = await controller.getObject(recordKey(id));
        if (!file) return undefined;
        let parsed: unknown;
        try {
            parsed = JSON.parse(await file.text());
        } catch {
            return undefined;
        }
        return isScanState(parsed, id) ? parsed : undefined;
    }

    async function write(controller: StorageController, state: OrphanScanState): Promise<void> {
        state.updatedAt = iso();
        if (state.deletion && (state.deletion.status === "queued" || state.deletion.status === "running")) {
            state.deletion.updatedAt = state.updatedAt;
        }
        const body = JSON.stringify(state);
        await controller.putObject(
            { file: new File([body], `${state.id}.json`, { type: "application/json" }), key: recordKey(state.id) },
            { uploadLimits: false }
        );
    }

    /** Delete records past retention, best effort: a scan never fails over housekeeping. */
    async function prune(controller: StorageController): Promise<void> {
        try {
            const cutoff = now() - RECORD_RETENTION_MS;
            let pageToken: string | undefined;
            do {
                const page = await controller.listObjects(ORPHAN_SCAN_FOLDER, { maxResults: 1000, pageToken });
                for (const item of page.items) {
                    const written = item.updated ? Date.parse(item.updated) : NaN;
                    if (Number.isFinite(written) && written < cutoff) {
                        await controller.deleteObject(item.fullPath).catch(() => undefined);
                    }
                }
                pageToken = page.nextPageToken;
            } while (pageToken);
        } catch (error: unknown) {
            logger.debug("[storage] Could not prune old orphan scan records", { error });
        }
    }

    /** Hand a scan or a delete to the job queue, or run it here in the background. Resolves with who runs it. */
    async function dispatch(payload: OrphanScanTaskPayload): Promise<{ runner: OrphanScanRunner; jobId?: string }> {
        const queue = config.jobs?.();
        if (queue) {
            // One attempt: a scan that timed out would time out again, and a
            // worker that died leaves a record the status reports as stalled.
            const jobId = await queue.enqueue(STORAGE_ORPHANS_TASK, payload, { maxAttempts: 1 });
            return { runner: "worker", ...(jobId ? { jobId } : {}) };
        }
        // No job queue on this backend: nobody else would ever run it.
        setImmediate(() => {
            runTask(payload).catch((error: unknown) => {
                logger.error("[storage] An orphan scan running in this process failed", { scanId: payload.scanId, error });
            });
        });
        return { runner: "in-process" };
    }

    /** The record as a caller should read it: a stalled run said as failed, a long queue explained. */
    function asReported(state: OrphanScanState): OrphanScanState {
        const reported: OrphanScanState = { ...state };
        const age = (at: string | undefined) => now() - (at ? Date.parse(at) : 0);
        const waiting = `It is a "${STORAGE_ORPHANS_TASK}" job on the job queue, run by a process whose job workers ` +
            "are on (the all or worker role, REBASE_JOB_WORKERS) and that runs this release.";
        if (state.status === "running" && age(state.updatedAt) > ORPHAN_SCAN_STALL_MS) {
            reported.status = "failed";
            reported.error = `The scan stopped reporting progress ${Math.round(age(state.updatedAt) / 60_000)} minutes ago: ` +
                "the process running it stopped (a deploy, a restart or a crash). Start another scan.";
        } else if (state.status === "queued" && age(state.createdAt) > QUEUED_NOTE_AFTER_MS) {
            if (state.runner === "worker") {
                reported.note = `No job worker has started this scan yet. ${waiting}`;
            } else {
                // Started on the next turn of the event loop of the process
                // that was asked: still queued a minute later, it never will be.
                reported.status = "failed";
                reported.error = "The scan was to run in the server process that was asked, and never started: that " +
                    "process restarted. Start another scan.";
            }
        }
        const deletion = state.deletion;
        if (deletion && deletion.status === "running" && age(deletion.updatedAt) > ORPHAN_SCAN_STALL_MS) {
            reported.deletion = {
                ...deletion,
                status: "failed",
                error: "The delete stopped reporting progress: the process running it stopped. Some files may have been " +
                    "deleted. Start another scan to see what is left."
            };
        } else if (deletion && deletion.status === "queued" && age(deletion.requestedAt) > QUEUED_NOTE_AFTER_MS) {
            reported.deletion = deletion.runner === "worker"
                ? { ...deletion, note: `No job worker has started this delete yet. ${waiting}` }
                : { ...deletion, status: "failed", error: "The delete was to run in the server process that was asked, and never started. Nothing was deleted." };
        }
        return reported;
    }

    async function runScan(controller: StorageController, state: OrphanScanState, signal?: AbortSignal): Promise<void> {
        state.status = "running";
        state.startedAt = iso();
        state.progress = emptyScanProgress();
        await write(controller, state);
        const writer = progressWriter(() => write(controller, state), now);
        try {
            state.result = await findOrphans({
                controller,
                collections: config.collections(),
                driverFor: config.driverFor,
                globalCallbacks: config.globalCallbacks?.(),
                history: config.history,
                olderThanMs: state.olderThanHours * 3_600_000,
                now: now(),
                progress: state.progress,
                onProgress: () => writer.tick(),
                signal
            });
            state.status = "completed";
            state.completedAt = iso();
        } catch (error: unknown) {
            state.status = "failed";
            state.error = signal?.aborted
                ? `The scan was stopped: ${messageOf(signal.reason ?? error)}. A scan is one job attempt, limited by ` +
                  "jobs.timeoutMs (15 minutes by default); raise it, or set it to 0, for a source this big."
                : messageOf(error);
            throw error;
        } finally {
            await writer.flush();
        }
    }

    async function runDeletion(controller: StorageController, state: OrphanScanState, signal?: AbortSignal): Promise<void> {
        const deletion = state.deletion;
        const result = state.result;
        if (!deletion || !result) return;
        deletion.status = "running";
        deletion.startedAt = iso();
        deletion.progress = { ...emptyScanProgress(), phase: "rows", candidates: result.orphans.length, deleted: 0 };
        await write(controller, state);
        const writer = progressWriter(() => write(controller, state), now);
        try {
            const outcome = await deleteScannedOrphans({
                controller,
                candidates: result.orphans,
                collections: config.collections(),
                driverFor: config.driverFor,
                globalCallbacks: config.globalCallbacks?.(),
                history: config.history,
                olderThanMs: state.olderThanHours * 3_600_000,
                now,
                progress: deletion.progress,
                onProgress: () => writer.tick(),
                onDeleted: () => {
                    deletion.progress.deleted++;
                },
                signal
            });
            deletion.result = { deleted: outcome.deleted, kept: outcome.kept, failed: outcome.failed };
            if (outcome.unscanned.length > 0) {
                deletion.status = "failed";
                deletion.error = "Some collections could not be read again, so a file they name now would look unused. " +
                    "Nothing was deleted: " + outcome.unscanned.map(entry => `${entry.collection} (${entry.reason})`).join("; ");
            } else {
                deletion.status = "completed";
            }
            deletion.completedAt = iso();
        } catch (error: unknown) {
            deletion.status = "failed";
            deletion.error = messageOf(signal?.aborted ? signal.reason ?? error : error);
            throw error;
        } finally {
            await writer.flush();
        }
    }

    async function runTask(payload: OrphanScanTaskPayload, signal?: AbortSignal): Promise<void> {
        const controller = sourceOf(payload.storageId);
        const state = await read(controller, payload.scanId);
        if (!state) {
            logger.warn("[storage] An orphan scan job names a scan its source holds no record of; nothing to do", { ...payload });
            return;
        }
        if (payload.mode === "scan") {
            // Run once: a job run again (a reclaimed claim) finds it begun.
            if (state.status !== "queued") return;
            await runScan(controller, state, signal);
        } else {
            if (state.deletion?.status !== "queued") return;
            await runDeletion(controller, state, signal);
        }
    }

    return {
        async start(options) {
            const controller = sourceOf(options.storageId);
            const storageId = canonicalStorageId(options.storageId);
            const olderThanHours = options.olderThanHours ?? DEFAULT_OLDER_THAN_HOURS;
            await prune(controller);
            const at = iso();
            const state: OrphanScanState = {
                id: randomUUID(),
                storageId,
                olderThanHours,
                runner: config.jobs?.() ? "worker" : "in-process",
                status: "queued",
                createdAt: at,
                updatedAt: at,
                progress: emptyScanProgress()
            };
            // Written before it is dispatched: the job reads it, and a status
            // asked for at once finds it.
            await write(controller, state);
            // The job id is answered, not stored: writing the record again
            // here could land after a fast worker's last write and put a
            // finished scan back to queued.
            const { runner, jobId } = await dispatch({ scanId: state.id, storageId, mode: "scan" });
            return { ...state, runner, ...(jobId ? { jobId } : {}) };
        },

        async status(storageId, id) {
            const controller = sourceOf(storageId);
            const state = await read(controller, id);
            return state ? asReported(state) : undefined;
        },

        async requestDeletion(storageId, id) {
            const controller = sourceOf(storageId);
            const stored = await read(controller, id);
            if (!stored) {
                throw new ApiError(404, "STORAGE_SCAN_NOT_FOUND",
                    `Source "${canonicalStorageId(storageId)}" holds no orphan scan "${id}". Scans are kept for 7 days; start another.`);
            }
            const state = asReported(stored);
            if (state.status !== "completed" || !state.result || !state.completedAt) {
                throw new ApiError(409, "STORAGE_SCAN_NOT_COMPLETE",
                    state.status === "failed"
                        ? `Scan "${id}" failed (${state.error ?? "no reason recorded"}), so it found nothing to delete. Start another scan.`
                        : `Scan "${id}" is ${state.status}. Nothing is deleted until it has completed; ask for its status until it has.`,
                    { status: state.status });
            }
            const unscanned: UnscannedCollection[] = state.result.unscanned;
            if (unscanned.length > 0) {
                throw ApiError.conflict(
                    "Some collections could not be read, so a file they name would look unused. Nothing was deleted: " +
                    unscanned.map(entry => `${entry.collection} (${entry.reason})`).join("; "),
                    "STORAGE_SCAN_INCOMPLETE",
                    { unscanned }
                );
            }
            const age = now() - Date.parse(state.completedAt);
            if (!(age <= ORPHAN_SCAN_TTL_MS)) {
                throw new ApiError(409, "STORAGE_SCAN_EXPIRED",
                    `Scan "${id}" completed ${Math.round(age / 60_000)} minutes ago; a delete acts only on a scan that completed ` +
                    `in the last ${ORPHAN_SCAN_TTL_MS / 60_000} minutes. Nothing was deleted. Start another scan.`);
            }
            if (state.deletion && state.deletion.status !== "failed") {
                throw new ApiError(409, "STORAGE_SCAN_DELETION_STARTED",
                    `The orphans of scan "${id}" are already being deleted (${state.deletion.status}). Ask for its status.`,
                    { status: state.deletion.status });
            }
            const at = iso();
            stored.deletion = {
                status: "queued",
                runner: config.jobs?.() ? "worker" : "in-process",
                requestedAt: at,
                updatedAt: at,
                progress: { ...emptyScanProgress(), phase: "rows", candidates: state.result.orphans.length, deleted: 0 }
            };
            await write(controller, stored);
            const { runner, jobId } = await dispatch({ scanId: id, storageId: stored.storageId, mode: "delete" });
            stored.deletion.runner = runner;
            if (jobId) stored.deletion.jobId = jobId;
            return asReported(stored);
        },

        runTask
    };
}
