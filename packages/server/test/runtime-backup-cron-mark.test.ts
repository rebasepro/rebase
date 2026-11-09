import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { Hono } from "hono";
import type { BackendBootstrapper, CollectionConfig, CronJobDefinition, DataDriver } from "@rebasepro/types";

import { initializeRebaseBackend } from "../src/index";
import { cronJobsFrom } from "../src/cron/cron-loader";
import { BACKUP_CRON_MARK, isBackupCronDefinition } from "../src/backup/backup-schedule";
import { _resetRebaseMock } from "../src/singleton";
import type { HonoEnv } from "../src/api/types";
import { fakeBootstrapper, fakeDataDriver, idleServer } from "./helpers/server-b-fakes";

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
    };
}

function bootstrapper(): BackendBootstrapper {
    // A driver that can be scoped to a caller: the boot looks for `withAuth`.
    const driver = {
        ...fakeDataDriver({ admin: { executeSql: async () => [] } }),
        withAuth: async (): Promise<DataDriver> => driver
    };
    return fakeBootstrapper({ driver, collections: undefined }, {
        async initializeAuth() {
            return { userService: {}, authRepository: {} };
        }
    });
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
        const app = new Hono<HonoEnv>();
        const backend = await initializeRebaseBackend({
            app,
            server: idleServer(),
            collections: [collection("widgets")],
            bootstrappers: [bootstrapper()],
            auth: { jwtSecret: "backup-mark-test-jwt-secret-0123456789abcdef", serviceKey: "backup-mark-test-service-key-0123456789" },
            cronPersistence: false,
            crons: { "nightly-backup": backupDefinition() }
        });
        stops.push(() => backend.shutdown(0));

        expect(backend.cronScheduler!.jobIdsWhere(isBackupCronDefinition)).toEqual(["nightly-backup"]);
    });
});
