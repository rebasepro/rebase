/**
 * An object-storage backup destination is read through a controller for its
 * own bucket.
 *
 * The admin backup routes were handed the app's default file-storage
 * controller. That is a different bucket at best — the backup cron builds its
 * own controller for BACKUP_DESTINATION from the `S3_*` variables — and in
 * production without an uploads bucket there is no default controller at all:
 * the listing answered `[]`, and the Backups panel said "No backups yet." under
 * an "S3" chip about a bucket full of backups. With local file storage in
 * development it listed `<uploads>/<bucket>/<prefix>` on disk, which is empty
 * too.
 */
import fs from "fs";
import os from "os";
import path from "path";
import type { CronJobDefinition } from "@rebasepro/types";
import { createBackupRoutes } from "../src/backup/backup-routes";
import { parseBackupDestination } from "../src/backup/backup-common";
import { backupStorageFromEnv, type ObjectBackupDestination } from "../src/backup/backup-storage";
import { readBackupSchedule } from "../src/backup/backup-schedule";
import { CronScheduler } from "../src/cron/cron-scheduler";
import { GCSStorageController } from "../src/storage/GCSStorageController";
import { S3StorageController } from "../src/storage/S3StorageController";
import type { StorageController } from "../src/storage";

const DUMP = "rebase-app-20260930T030000Z.dump";

/** A bucket holding `keys`, as much of a controller as the listing reads. */
function bucketWith(keys: string[]): StorageController {
    return {
        listObjects: async () => ({
            items: keys.map(fullPath => ({ fullPath })),
            prefixes: []
        })
    } as unknown as StorageController;
}

const S3_VARS = ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_ENDPOINT", "S3_REGION", "S3_FORCE_PATH_STYLE"] as const;

describe("GET /admin/backups — an object-storage destination", () => {
    const saved: Partial<Record<(typeof S3_VARS)[number], string>> = {};
    beforeEach(() => {
        for (const name of S3_VARS) {
            saved[name] = process.env[name];
            delete process.env[name];
        }
    });
    afterEach(() => {
        for (const name of S3_VARS) {
            if (saved[name] === undefined) delete process.env[name];
            else process.env[name] = saved[name];
        }
    });

    it("lists through a controller for the destination's own bucket", async () => {
        const storageFor = jest.fn((_dest: ObjectBackupDestination) => bucketWith([`nightly/${DUMP}`]));
        const router = createBackupRoutes({
            getDestination: () => parseBackupDestination("s3://acme-backups/nightly"),
            storageFor
        });

        const res = await router.request("/");

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.backups.map((b: { key: string }) => b.key)).toEqual([`nightly/${DUMP}`]);
        expect(storageFor).toHaveBeenCalledWith({ kind: "s3", bucket: "acme-backups", prefix: "nightly" });
    });

    it("says it cannot read an s3 destination it has no credentials for, rather than listing nothing", async () => {
        const router = createBackupRoutes({ getDestination: () => parseBackupDestination("s3://acme-backups/nightly") });

        const res = await router.request("/");

        expect(res.status).toBe(503);
        const { error } = await res.json();
        expect(error.message).toContain("s3://acme-backups/nightly");
        expect(error.message).toContain("S3_ACCESS_KEY_ID");
    });

    it("says a listing the bucket refused failed, rather than listing nothing", async () => {
        const refusing = {
            listObjects: async () => { throw new Error("Access Denied"); }
        } as unknown as StorageController;
        const router = createBackupRoutes({
            getDestination: () => parseBackupDestination("gs://acme-backups"),
            storageFor: () => refusing
        });

        const res = await router.request("/");

        expect(res.status).toBe(503);
        const { error } = await res.json();
        expect(error.message).toContain("gs://acme-backups");
        expect(error.message).toContain("Access Denied");
    });

    it("downloads through the same controller", async () => {
        const file = new File(["PGDMP"], DUMP);
        const storage = {
            getObject: async (key: string, bucket?: string) =>
                (key === `nightly/${DUMP}` && bucket === "acme-backups" ? file : null)
        } as unknown as StorageController;
        const router = createBackupRoutes({
            getDestination: () => parseBackupDestination("s3://acme-backups/nightly"),
            storageFor: () => storage
        });

        const res = await router.request(`/download?key=${encodeURIComponent(`nightly/${DUMP}`)}`);

        expect(res.status).toBe(200);
        expect(await res.text()).toBe("PGDMP");
    });
});

describe("backupStorageFromEnv", () => {
    it("builds an S3 controller for the destination's bucket from the S3_* variables", () => {
        const storage = backupStorageFromEnv(
            { kind: "s3", bucket: "acme-backups", prefix: "nightly" },
            { S3_ACCESS_KEY_ID: "key", S3_SECRET_ACCESS_KEY: "secret", S3_ENDPOINT: "http://minio:9000" }
        );

        expect(storage).toBeInstanceOf(S3StorageController);
        expect(storage.knownBuckets?.()).toContain("acme-backups");
    });

    it("builds a GCS controller for the destination's bucket", () => {
        const storage = backupStorageFromEnv({ kind: "gcs", bucket: "acme-backups", prefix: "" }, {});

        expect(storage).toBeInstanceOf(GCSStorageController);
        expect(storage.knownBuckets?.()).toContain("acme-backups");
    });

    it("refuses an S3 destination without credentials, naming what is missing", () => {
        expect(() => backupStorageFromEnv({ kind: "s3", bucket: "acme-backups", prefix: "" }, {}))
            .toThrow(/S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY/);
    });
});

describe("GET /admin/backups — a local destination read from a process that does not schedule", () => {
    let dir: string;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-local-")); });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    function backupScheduler(): CronScheduler {
        const definition: CronJobDefinition = { name: "Nightly", schedule: "0 3 * * *", handler: async () => undefined };
        Object.defineProperty(definition, Symbol.for("rebase.backupCron"), { value: true });
        const scheduler = new CronScheduler();
        scheduler.registerJobs([{ id: "backup", definition }]);
        return scheduler;
    }

    async function listing(options: { scheduledElsewhere: boolean; withJob: boolean }) {
        const scheduler = options.withJob ? backupScheduler() : new CronScheduler();
        const router = createBackupRoutes({
            getDestination: () => ({ kind: "local", path: dir }),
            getSchedule: () => readBackupSchedule(scheduler),
            scheduledElsewhere: options.scheduledElsewhere
        });
        return (await router.request("/")).json();
    }

    it("says the list is this process's disk when the scheduled backup runs in another process", async () => {
        // The api role of a split deployment: the worker writes the dumps to
        // its own disk, and this listing reads the api pod's.
        expect((await listing({ scheduledElsewhere: true, withJob: true })).localDiskOfThisProcess).toBe(true);
    });

    it("says nothing of the kind where this process runs the schedule, or there is none", async () => {
        expect((await listing({ scheduledElsewhere: false, withJob: true })).localDiskOfThisProcess).toBeUndefined();
        expect((await listing({ scheduledElsewhere: true, withJob: false })).localDiskOfThisProcess).toBeUndefined();
    });
});
