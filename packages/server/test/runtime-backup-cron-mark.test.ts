import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { Hono } from "hono";
import type { BackendBootstrapper, CollectionConfig, CronJobDefinition, InitializedDriver } from "@rebasepro/types";

import { initializeRebaseBackend } from "../src/index";
import { cronJobsFrom } from "../src/cron/cron-loader";
import { BACKUP_CRON_MARK, isBackupCronDefinition } from "../src/backup/backup-schedule";
import { _resetRebaseMock } from "../src/singleton";

/**
 * The Backups panel finds the scheduled backup by a mark on its definition:
 * `createBackupCron` puts `Symbol.for("rebase.backupCron")` on the job it
 * returns, non-enumerable so a JSON dump of the definition is unchanged. The
 * definition reaches the scheduler through copies — defaults filled in by
 * `cronJobsFrom`, the handler wrapped in the backend's scope — and each copy
 * has to carry the mark, or the panel reports no scheduled backup on a
 * deployment that runs one every night.
 */

function backupDefinition(): CronJobDefinition {
    const definition: CronJobDefinition = { schedule: "0 3 * * *", handler: async () => undefined };
    Object.defineProperty(definition, BACKUP_CRON_MARK, { value: true });
    return definition;
}

function collection(slug: string): CollectionConfig {
    return {
        name: slug,
        slug,
        table: slug,
        properties: { id: { name: "ID", type: "string", isId: "uuid" } }
    } as unknown as CollectionConfig;
}

function bootstrapper(): BackendBootstrapper {
    const driver = {
        fetchCollection: async () => [],
        withAuth: async () => driver,
        admin: { executeSql: async () => [] }
    };
    return {
        type: "fake",
        isDefault: true,
        async initializeDriver(): Promise<InitializedDriver> {
            return { driver, collections: undefined, internals: {} } as unknown as InitializedDriver;
        },
        async initializeAuth() {
            return { userService: {}, authRepository: {} };
        }
    } as unknown as BackendBootstrapper;
}

const stops: Array<() => Promise<void>> = [];

afterEach(async () => {
    while (stops.length) await stops.pop()!();
    _resetRebaseMock();
    jest.restoreAllMocks();
});

describe("the backup cron's mark", () => {
    it("survives the defaults cronJobsFrom fills in", () => {
        const [job] = cronJobsFrom({ backup: backupDefinition() });
        expect(isBackupCronDefinition(job.definition)).toBe(true);
        // Still hidden: a copy carries it the way the original did.
        expect(Object.getOwnPropertyDescriptor(job.definition, BACKUP_CRON_MARK)?.enumerable).toBe(false);
    });

    it("reaches the scheduler a backend boots", async () => {
        const app = new Hono();
        const backend = await initializeRebaseBackend({
            app: app as never,
            server: { close: (cb: () => void) => cb() } as never,
            collections: [collection("widgets")],
            bootstrappers: [bootstrapper()],
            auth: { jwtSecret: "backup-mark-test-jwt-secret-0123456789abcdef", serviceKey: "backup-mark-test-service-key-0123456789" },
            cronPersistence: false,
            crons: { "nightly-backup": backupDefinition() }
        } as never);
        stops.push(() => backend.shutdown(0));

        expect(backend.cronScheduler!.jobIdsWhere(isBackupCronDefinition)).toEqual(["nightly-backup"]);
    });
});
