import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Hono } from "hono";
import type { CollectionConfig, DataDriver, FetchCollectionProps } from "@rebasepro/types";

import { LocalStorageController } from "../src/storage/LocalStorageController";
import { DefaultStorageRegistry } from "../src/storage/storage-registry";
import { createStorageMaintenanceRoutes } from "../src/storage/maintenance-routes";
import { createStorageRoutes } from "../src/storage/routes";
import {
    createOrphanScanService,
    ORPHAN_SCAN_FOLDER,
    ORPHAN_SCAN_STALL_MS,
    ORPHAN_SCAN_TTL_MS,
    STORAGE_ORPHANS_TASK,
    type OrphanScanService,
    type OrphanScanState,
    type OrphanScanTaskPayload
} from "../src/storage/orphan-scans";
import { moveObjects } from "../src/storage/maintenance";
import { errorHandler } from "../src/api/errors";
import type { HonoEnv } from "../src/api/types";
import type { EnqueueOptions, JobQueueClient } from "../src/jobs/types";

/**
 * `rebase storage orphans` as background work.
 *
 * The scan read every object and every row inside one HTTP request, and an
 * ingress in front of a big project answered 504 long before it finished —
 * twice for a delete, which scanned again. Now a scan is started, runs as a
 * `storage.orphans` job (or in the process that was asked, when the backend
 * runs no job queue), and is asked about; a delete acts only on a completed,
 * recent, whole scan, and checks every candidate again before it goes.
 */

const HOUR = 3_600_000;

/** A driver over rows that can change between calls, paged by `startAfter`. */
function driverOver(rows: () => Record<string, unknown>[], fail?: () => string | undefined): DataDriver {
    return {
        async fetchCollection(props: FetchCollectionProps) {
            const failure = fail?.();
            if (failure) throw new Error(failure);
            const visible = props.withDeleted ? rows() : rows().filter(row => !row.deleted_at);
            const start = props.startAfter ? visible.indexOf(props.startAfter as Record<string, unknown>) + 1 : 0;
            return visible.slice(start, start + (props.limit ?? visible.length));
        }
    } as unknown as DataDriver;
}

const collection = (slug: string): CollectionConfig => ({ slug, name: slug, table: slug, properties: {} } as unknown as CollectionConfig);

async function put(controller: LocalStorageController, key: string, content = "x"): Promise<void> {
    await controller.putObject({ file: new File([content], key.split("/").pop() ?? "f", { type: "text/plain" }), key });
}

/** A job queue that records what it was handed, for the test to run as a worker would. */
function recordingQueue(): JobQueueClient & { jobs: { task: string; payload: OrphanScanTaskPayload; options?: EnqueueOptions }[] } {
    const jobs: { task: string; payload: OrphanScanTaskPayload; options?: EnqueueOptions }[] = [];
    return {
        jobs,
        async enqueue<P>(task: string, payload?: P, options?: EnqueueOptions) {
            jobs.push({ task, payload: payload as unknown as OrphanScanTaskPayload, options });
            return `job-${jobs.length}`;
        }
    };
}

describe("the orphan scan, in the background", () => {
    let root: string;
    let storage: LocalStorageController;
    let rows: Record<string, Record<string, unknown>[]>;
    let failing: string | undefined;
    let clock: number;

    const age = async (key: string, hours: number) => {
        const when = new Date(Date.now() - hours * HOUR);
        await fs.promises.utimes(path.join(root, "default", key), when, when);
    };

    beforeEach(async () => {
        root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-orphan-scans-"));
        storage = new LocalStorageController({ type: "local", basePath: root });
        for (const key of ["avatars/kept.png", "avatars/old.png", "avatars/old2.png", "avatars/old3.png", "fresh.png"]) await put(storage, key);
        for (const key of ["avatars/kept.png", "avatars/old.png", "avatars/old2.png", "avatars/old3.png"]) await age(key, 48);
        rows = {
            users: [{ id: "1", avatar: "avatars/kept.png" }],
            posts: [{ id: "1", title: "no files" }, { id: "2", title: "none here either" }]
        };
        failing = undefined;
        clock = Date.now();
    });

    afterEach(async () => {
        await fs.promises.rm(root, { recursive: true, force: true });
    });

    const sources = () => ({
        registry: DefaultStorageRegistry.create({ "(default)": storage }),
        collections: () => [collection("users"), collection("posts")],
        driverFor: (c: CollectionConfig) => driverOver(() => rows[c.slug], () => c.slug === "posts" ? failing : undefined),
        now: () => clock
    });

    const appWith = (scans: OrphanScanService) => {
        const hono = new Hono<HonoEnv>();
        hono.onError(errorHandler);
        hono.route("/admin/storage", createStorageMaintenanceRoutes({ ...sources(), orphanScans: scans }));
        return hono;
    };

    const json = async (response: Response) => (await response.json()) as { data: OrphanScanState; error?: { code: string; message: string } };

    /** Ask for a scan's status until `done` says so. */
    async function until(app: Hono<HonoEnv>, id: string, done: (state: OrphanScanState) => boolean): Promise<OrphanScanState> {
        for (let i = 0; i < 200; i++) {
            const state = (await json(await app.request(`/admin/storage/orphans/scans/${id}`))).data;
            if (done(state)) return state;
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        throw new Error("the scan never got there");
    }

    it("runs in the process that was asked when the backend runs no job queue, and says so", async () => {
        const app = appWith(createOrphanScanService(sources()));
        const started = await app.request("/admin/storage/orphans/scans", { method: "POST" });
        expect(started.status).toBe(202);
        const state = (await json(started)).data;
        expect(state).toMatchObject({ status: "queued", runner: "in-process", storageId: "(default)", olderThanHours: 24 });

        const done = await until(app, state.id, s => s.status === "completed");
        expect(done.result?.orphans.map(o => o.key)).toEqual(["avatars/old.png", "avatars/old2.png", "avatars/old3.png"]);
        expect(done.result?.recent).toBe(1);
        expect(done.progress).toMatchObject({ phase: "done", filesScanned: 5, rowsScanned: 3, collectionsScanned: 2, collectionsTotal: 2, unscanned: [] });
    });

    it("is a storage.orphans job when the backend runs a job queue, and a worker's run is what the status reads", async () => {
        const queue = recordingQueue();
        const scans = createOrphanScanService({ ...sources(), jobs: () => queue });
        const app = appWith(scans);

        const state = (await json(await app.request("/admin/storage/orphans/scans?olderThanHours=1", { method: "POST" }))).data;
        expect(state).toMatchObject({ status: "queued", runner: "worker", jobId: "job-1", olderThanHours: 1 });
        expect(queue.jobs).toEqual([{
            task: STORAGE_ORPHANS_TASK,
            payload: { scanId: state.id, storageId: "(default)", mode: "scan" },
            options: { maxAttempts: 1 }
        }]);

        // Nothing runs it until a worker does.
        await new Promise(resolve => setTimeout(resolve, 20));
        expect((await json(await app.request(`/admin/storage/orphans/scans/${state.id}`))).data.status).toBe("queued");

        await scans.runTask(queue.jobs[0].payload);
        const done = (await json(await app.request(`/admin/storage/orphans/scans/${state.id}`))).data;
        expect(done.status).toBe("completed");
        expect(done.result?.orphans).toHaveLength(3);

        // A job run again (a reclaimed claim) finds it done and leaves it.
        await scans.runTask(queue.jobs[0].payload);
        expect((await json(await app.request(`/admin/storage/orphans/scans/${state.id}`))).data.completedAt).toBe(done.completedAt);
    });

    it("says which collections it could not read, as it goes, and a delete from it is refused", async () => {
        failing = "connection refused";
        const queue = recordingQueue();
        const scans = createOrphanScanService({ ...sources(), jobs: () => queue });
        const app = appWith(scans);
        const state = (await json(await app.request("/admin/storage/orphans/scans", { method: "POST" }))).data;
        await scans.runTask(queue.jobs[0].payload);

        const done = (await json(await app.request(`/admin/storage/orphans/scans/${state.id}`))).data;
        expect(done.progress.unscanned).toEqual([{ collection: "posts", reason: "connection refused" }]);
        const refused = await app.request(`/admin/storage/orphans?scan=${state.id}`, { method: "DELETE" });
        expect(refused.status).toBe(409);
        expect((await json(refused)).error?.code).toBe("STORAGE_SCAN_INCOMPLETE");
        expect(await storage.statObject("avatars/old.png")).not.toBeNull();
    });

    it("deletes only from a completed scan, recent, and never twice at once", async () => {
        const queue = recordingQueue();
        const scans = createOrphanScanService({ ...sources(), jobs: () => queue });
        const app = appWith(scans);

        const unknown = await app.request("/admin/storage/orphans?scan=6f1d7a52-3c51-4a8e-9a43-0d3cbf6a7e11", { method: "DELETE" });
        expect(unknown.status).toBe(404);
        expect((await json(unknown)).error?.code).toBe("STORAGE_SCAN_NOT_FOUND");
        // Not a scan id at all: never a path into the source.
        expect((await app.request("/admin/storage/orphans/scans/..%2F..%2Fsecret")).status).toBe(404);

        const state = (await json(await app.request("/admin/storage/orphans/scans", { method: "POST" }))).data;
        const early = await app.request(`/admin/storage/orphans?scan=${state.id}`, { method: "DELETE" });
        expect(early.status).toBe(409);
        expect((await json(early)).error?.code).toBe("STORAGE_SCAN_NOT_COMPLETE");

        await scans.runTask(queue.jobs[0].payload);
        clock += ORPHAN_SCAN_TTL_MS + 60_000;
        const late = await app.request(`/admin/storage/orphans?scan=${state.id}`, { method: "DELETE" });
        expect(late.status).toBe(409);
        expect((await json(late)).error?.code).toBe("STORAGE_SCAN_EXPIRED");
        clock -= ORPHAN_SCAN_TTL_MS + 60_000;

        const accepted = await app.request(`/admin/storage/orphans?scan=${state.id}`, { method: "DELETE" });
        expect(accepted.status).toBe(202);
        expect((await json(accepted)).data.deletion).toMatchObject({ status: "queued", runner: "worker" });
        expect(queue.jobs[1]).toMatchObject({ task: STORAGE_ORPHANS_TASK, payload: { scanId: state.id, mode: "delete" } });
        const twice = await app.request(`/admin/storage/orphans?scan=${state.id}`, { method: "DELETE" });
        expect(twice.status).toBe(409);
        expect((await json(twice)).error?.code).toBe("STORAGE_SCAN_DELETION_STARTED");
        // Nothing deleted until the job runs.
        expect(await storage.statObject("avatars/old.png")).not.toBeNull();

        await scans.runTask(queue.jobs[1].payload);
        const done = (await json(await app.request(`/admin/storage/orphans/scans/${state.id}`))).data;
        expect(done.deletion).toMatchObject({ status: "completed", progress: { candidates: 3, deleted: 3 } });
        expect(done.deletion?.result?.deleted).toEqual(["avatars/old.png", "avatars/old2.png", "avatars/old3.png"]);
        for (const key of ["avatars/old.png", "avatars/old2.png", "avatars/old3.png"]) expect(await storage.statObject(key)).toBeNull();
        for (const key of ["avatars/kept.png", "fresh.png"]) expect(await storage.statObject(key)).not.toBeNull();
    });

    it("checks every candidate again before deleting it: a row naming it now, or a newer version, keeps it", async () => {
        const app = appWith(createOrphanScanService(sources()));
        const state = (await json(await app.request("/admin/storage/orphans/scans", { method: "POST" }))).data;
        await until(app, state.id, s => s.status === "completed");

        // Since the scan: a row picked one up, and another was uploaded again.
        rows.users.push({ id: "2", avatar: "avatars/old.png" });
        await put(storage, "avatars/old2.png", "a new upload under the same key");

        expect((await app.request(`/admin/storage/orphans?scan=${state.id}`, { method: "DELETE" })).status).toBe(202);
        const done = await until(app, state.id, s => s.deletion?.status === "completed");
        expect(done.deletion?.result?.deleted).toEqual(["avatars/old3.png"]);
        expect(done.deletion?.result?.kept).toEqual([
            { key: "avatars/old.png", reason: "a row or a history entry names it now" },
            { key: "avatars/old2.png", reason: "it was written again since the scan" }
        ]);
        expect(await storage.statObject("avatars/old.png")).not.toBeNull();
        expect(await storage.statObject("avatars/old2.png")).not.toBeNull();
        expect(await storage.statObject("avatars/old3.png")).toBeNull();
    });

    it("deletes nothing when a collection cannot be read again for the delete", async () => {
        const app = appWith(createOrphanScanService(sources()));
        const state = (await json(await app.request("/admin/storage/orphans/scans", { method: "POST" }))).data;
        await until(app, state.id, s => s.status === "completed");
        failing = "connection refused";

        expect((await app.request(`/admin/storage/orphans?scan=${state.id}`, { method: "DELETE" })).status).toBe(202);
        const done = await until(app, state.id, s => s.deletion?.status === "failed");
        expect(done.deletion?.error).toMatch(/Nothing was deleted: posts \(connection refused\)/);
        expect(done.deletion?.result?.deleted).toEqual([]);
        for (const key of ["avatars/old.png", "avatars/old2.png", "avatars/old3.png"]) expect(await storage.statObject(key)).not.toBeNull();
    });

    it("reports a run that stopped reporting as failed, and a stopped job names jobs.timeoutMs", async () => {
        const queue = recordingQueue();
        const scans = createOrphanScanService({ ...sources(), jobs: () => queue });
        const app = appWith(scans);
        const state = (await json(await app.request("/admin/storage/orphans/scans", { method: "POST" }))).data;

        const stopped = new AbortController();
        stopped.abort(new Error("\"storage.orphans\" timed out after 900000ms (jobs.timeoutMs)"));
        await expect(scans.runTask(queue.jobs[0].payload, stopped.signal)).rejects.toThrow();
        const failed = (await json(await app.request(`/admin/storage/orphans/scans/${state.id}`))).data;
        expect(failed.status).toBe("failed");
        expect(failed.error).toMatch(/jobs\.timeoutMs/);

        // A worker that died mid-scan leaves a record saying "running".
        const second = (await json(await app.request("/admin/storage/orphans/scans", { method: "POST" }))).data;
        const record = `${ORPHAN_SCAN_FOLDER}/${second.id}.json`;
        const stored = JSON.parse(await (await storage.getObject(record))!.text()) as OrphanScanState;
        await storage.putObject({
            file: new File([JSON.stringify({ ...stored, status: "running", updatedAt: new Date(clock).toISOString() })], "s.json"),
            key: record
        }, { uploadLimits: false });
        expect((await json(await app.request(`/admin/storage/orphans/scans/${second.id}`))).data.status).toBe("running");
        clock += ORPHAN_SCAN_STALL_MS + 60_000;
        const stalled = (await json(await app.request(`/admin/storage/orphans/scans/${second.id}`))).data;
        expect(stalled.status).toBe("failed");
        expect(stalled.error).toMatch(/stopped reporting progress/);
    });

    it("keeps its records where no storage door reaches them, and no scan or move sees them", async () => {
        const app = appWith(createOrphanScanService(sources()));
        const state = (await json(await app.request("/admin/storage/orphans/scans", { method: "POST" }))).data;
        const done = await until(app, state.id, s => s.status === "completed");
        expect(done.result?.objects).toBe(5);

        // Written by a caller, a record would choose what a later delete removes.
        const doors = new Hono<HonoEnv>();
        doors.onError(errorHandler);
        doors.route("/api/storage", createStorageRoutes({ controller: storage, requireAuth: false }));
        const recordPath = `${ORPHAN_SCAN_FOLDER}/${state.id}.json`;
        expect((await doors.request(`/api/storage/file/${recordPath}`)).status).toBe(400);
        expect((await doors.request(`/api/storage/file/_REBASE/Maintenance/orphan-scans/${state.id}.json`)).status).toBe(400);
        const form = new FormData();
        form.append("file", new File([JSON.stringify({ forged: true })], "x.json", { type: "application/json" }));
        form.append("key", recordPath);
        const upload = await doors.request("/api/storage/upload", { method: "POST", body: form });
        expect(upload.status).toBe(400);
        expect(((await upload.json()) as { error: { code: string } }).error.code).toBe("INVALID_STORAGE_KEY");
        expect((await doors.request("/api/storage/list?prefix=_rebase/maintenance")).status).toBe(400);

        // A second scan does not count the first one's record as a file.
        const again = (await json(await app.request("/admin/storage/orphans/scans", { method: "POST" }))).data;
        expect((await until(app, again.id, s => s.status === "completed")).result?.objects).toBe(5);

        // And a move does not carry it over.
        const otherRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-orphan-scans-to-"));
        try {
            const target = new LocalStorageController({ type: "local", basePath: otherRoot });
            const moved = await moveObjects({ from: storage, to: target, limit: 100 });
            expect(moved.moved.map(m => m.key).some(key => key.startsWith("_rebase"))).toBe(false);
        } finally {
            await fs.promises.rm(otherRoot, { recursive: true, force: true });
        }
    });

    it("keeps the scan inside a request working for a release, marked deprecated", async () => {
        const app = appWith(createOrphanScanService(sources()));
        const listed = await app.request("/admin/storage/orphans");
        expect(listed.status).toBe(200);
        expect(listed.headers.get("Deprecation")).toBe("true");
        expect(listed.headers.get("Link")).toContain("/api/admin/storage/orphans/scans");
        expect(((await listed.json()) as { data: { orphans: unknown[] } }).data.orphans).toHaveLength(3);
    });
});
