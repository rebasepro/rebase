/**
 * `bucket(…, { orphanSweep })`: the orphan scan, as a scheduled cron job.
 *
 * Deleting a row leaves its files behind, on purpose (a key may be named by
 * another row, a history entry, or app code). What these pin is that the sweep
 * deletes only what `rebase storage orphans --delete` would: unnamed files past
 * the grace period, nothing at all when a collection cannot be read, and that a
 * declaration it cannot honour is refused out loud rather than swept wrongly.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { CollectionConfig, DataDriver, FetchCollectionProps, StorageSourceDefinition } from "@rebasepro/types";
import { bucket, resetDeclaredResources, declaredStorageSources } from "@rebasepro/types";

import { LocalStorageController } from "../src/storage/LocalStorageController";
import {
    DEFAULT_ORPHAN_SWEEP_HOURS,
    DEFAULT_ORPHAN_SWEEP_SCHEDULE,
    orphanSweepJobId,
    orphanSweepJobs,
    runOrphanSweep
} from "../src/storage/orphan-sweep";
import { validateCronExpression } from "../src/cron/cron-scheduler";
import type { HonoEnv } from "../src/api/types";
import { fakeBootstrapper, fakeDataDriver, idleServer } from "./helpers/server-b-fakes";
import { tablesFrom } from "./helpers/tables";

const HOUR = 3_600_000;

function driverOver(rows: Record<string, unknown>[], fail?: string): DataDriver {
    return fakeDataDriver({
        async fetchCollection(props: FetchCollectionProps) {
            if (fail) throw new Error(fail);
            const start = props.startAfter ? rows.findIndex(row => row === props.startAfter) + 1 : 0;
            return rows.slice(start, start + (props.limit ?? rows.length));
        }
    });
}

const collection = (slug: string): CollectionConfig => ({ slug, name: slug, table: slug, properties: {} });
const source = (over: Partial<StorageSourceDefinition> = {}): StorageSourceDefinition =>
    ({ key: "(default)", engine: "local", transport: "server", ...over });

describe("the sweep a bucket declares", () => {
    afterEach(() => resetDeclaredResources());

    it("reaches the storage source from bucket(…, { orphanSweep })", () => {
        bucket("voice", { orphanSweep: { olderThanHours: 72 } });
        bucket("media", { orphanSweep: true });
        bucket("plain");
        const byKey = Object.fromEntries(declaredStorageSources().map(s => [s.key, s.orphanSweep]));
        expect(byKey).toEqual({ voice: { olderThanHours: 72 }, media: {}, plain: undefined });
    });

    it("is one cron job per source that asks, with safe defaults", () => {
        const { jobs, problems } = orphanSweepJobs(
            [source({ orphanSweep: {} }), source({ key: "voice", orphanSweep: { olderThanHours: 72, schedule: "0 3 * * 0" } }), source({ key: "plain" })],
            { collections: () => [], driverFor: () => undefined }
        );
        expect(problems).toEqual([]);
        expect(jobs.map(j => j.id)).toEqual(["storage-orphan-sweep-default", "storage-orphan-sweep-voice"]);
        expect(jobs[0].definition.schedule).toBe(DEFAULT_ORPHAN_SWEEP_SCHEDULE);
        expect(jobs[0].definition.description).toContain(`${DEFAULT_ORPHAN_SWEEP_HOURS} hours`);
        expect(jobs[1].definition.schedule).toBe("0 3 * * 0");
        expect(validateCronExpression(DEFAULT_ORPHAN_SWEEP_SCHEDULE)).toEqual({ valid: true });
        expect(orphanSweepJobId("Profile Pics")).toBe("storage-orphan-sweep-profile-pics");
    });

    it("refuses a grace period short enough to take an upload whose row is not saved yet", () => {
        const { jobs, problems } = orphanSweepJobs(
            [source({ key: "voice", orphanSweep: { olderThanHours: 2 } })],
            { collections: () => [], driverFor: () => undefined }
        );
        expect(jobs).toEqual([]);
        expect(problems[0]).toMatch(/at least 24/);
    });

    it("refuses a bucket the backend never reaches", () => {
        const { jobs, problems } = orphanSweepJobs(
            [source({ key: "direct", transport: "direct", orphanSweep: {} })],
            { collections: () => [], driverFor: () => undefined }
        );
        expect(jobs).toEqual([]);
        expect(problems[0]).toMatch(/"direct"/);
    });
});

describe("one sweep", () => {
    let root: string;
    let storage: LocalStorageController;
    const lines: string[] = [];
    const ctx = { log: (...args: unknown[]) => { lines.push(args.join(" ")); }, signal: new AbortController().signal };

    async function put(key: string, hoursOld: number): Promise<void> {
        await storage.putObject({ file: new File(["x"], key.split("/").pop()!, { type: "text/plain" }), key });
        const when = new Date(Date.now() - hoursOld * HOUR);
        await fs.promises.utimes(path.join(root, "default", key), when, when);
    }

    beforeEach(async () => {
        lines.length = 0;
        root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-sweep-"));
        storage = new LocalStorageController({ type: "local", basePath: root });
        await put("voice/named.wav", 400);    // a row names it
        await put("voice/deleted.wav", 400);  // its row is gone
        await put("voice/fresh.wav", 2);      // its row may not be saved yet
    });

    afterEach(async () => {
        await fs.promises.rm(root, { recursive: true, force: true });
    });

    const exists = (key: string) => fs.existsSync(path.join(root, "default", key));

    it("deletes the unnamed file past the grace period, and only that one", async () => {
        const result = await runOrphanSweep("(default)", 168, {
            controller: storage,
            collections: () => [collection("voice_cache")],
            driverFor: () => driverOver([{ id: "1", audio: "voice/named.wav" }])
        }, ctx);

        expect(result).toMatchObject({ objects: 3, deleted: 1, recent: 1, kept: 0, failed: [], unscanned: [] });
        expect(exists("voice/deleted.wav")).toBe(false);
        expect(exists("voice/named.wav")).toBe(true);
        expect(exists("voice/fresh.wav")).toBe(true);
        expect(lines.join("\n")).toMatch(/Deleted 1 unreferenced file/);
    });

    it("deletes nothing when a collection cannot be read", async () => {
        const result = await runOrphanSweep("(default)", 168, {
            controller: storage,
            collections: () => [collection("voice_cache")],
            driverFor: () => driverOver([], "connection refused")
        }, ctx);

        expect(result.deleted).toBe(0);
        expect(result.unscanned.length).toBe(1);
        expect(exists("voice/deleted.wav")).toBe(true);
        expect(lines.join("\n")).toMatch(/Kept every file/);
    });

    it("fails the run, rather than sweeping nothing, when the source is not configured", async () => {
        await expect(runOrphanSweep("voice", 168, {
            collections: () => [],
            driverFor: () => undefined
        }, ctx)).rejects.toThrow(/"voice" is not configured/);
    });
});

describe("a backend whose bucket declares a sweep", () => {
    let root: string;

    beforeEach(async () => {
        root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-sweep-wiring-"));
    });

    afterEach(async () => {
        resetDeclaredResources();
        await fs.promises.rm(root, { recursive: true, force: true });
    });

    const bootstrapper = fakeBootstrapper({}, {
        async initializeAuth() {
            return { userService: {}, authRepository: {} };
        }
    });

    it("lists the sweep with its crons, without a crons directory", async () => {
        bucket({ orphanSweep: { olderThanHours: 48 } });
        const { initializeRebaseBackend } = await import("../src/init");
        const { Hono } = await import("hono");
        const backend = await initializeRebaseBackend({
            app: new Hono<HonoEnv>(),
            server: idleServer(),
            ...tablesFrom([collection("voice_cache")]),
            cronPersistence: false,
            bootstrappers: [bootstrapper],
            storage: { type: "local", basePath: root }
        });
        const ids = (backend.cronScheduler?.listJobs() ?? []).map(job => job.id);
        expect(ids).toContain("storage-orphan-sweep-default");
    });
});
