import { describe, expect, it, afterEach, beforeEach } from "@jest/globals";
import { Hono } from "hono";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { BackendBootstrapper, CollectionConfig, DataDriver } from "@rebasepro/types";

import { initializeRebaseBackend } from "../src/init";
import type { HonoEnv } from "../src/api/types";
import { fakeBootstrapper, fakeDataDriver, idleServer } from "./helpers/server-b-fakes";
import { STORAGE_ORPHANS_TASK } from "../src/storage/orphan-scans";

/**
 * The backend wires the orphan scan's `storage.orphans` handler onto its job
 * queue in every process that has storage — a worker pod most of all, which
 * serves no admin surface. A handler registered only beside the admin routes
 * would leave every scan an api pod enqueued sitting in the table, because a
 * worker only claims the tasks it has a handler for.
 */

function collection(slug: string): CollectionConfig {
    return {
        name: slug,
        slug,
        table: slug,
        properties: { id: { name: "ID", type: "string", isId: "uuid" } }
    };
}

/** Records every statement with its parameters, and answers no rows. */
function recordingDriver(calls: { sql: string; params: unknown[] }[]): DataDriver {
    return fakeDataDriver({
        admin: {
            executeSql: async (sql, options) => {
                calls.push({ sql, params: options?.params ?? [] });
                return [];
            }
        }
    });
}

function bootstrapperFor(calls: { sql: string; params: unknown[] }[]): BackendBootstrapper {
    return fakeBootstrapper({ driver: recordingDriver(calls) }, {
        async initializeAuth() {
            return { userService: {}, authRepository: {} };
        }
    });
}

type Backend = Awaited<ReturnType<typeof initializeRebaseBackend>>;

describe("the storage.orphans job handler", () => {
    let root: string;
    const started: Backend[] = [];

    beforeEach(async () => {
        root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-orphan-wiring-"));
    });

    afterEach(async () => {
        while (started.length) await started.pop()!.jobQueue?.stop(0);
        await fs.promises.rm(root, { recursive: true, force: true });
    });

    /** The tasks a worker of this backend claims, read off its claim statement. */
    async function claimedTasks(options: { admin: boolean }): Promise<unknown[]> {
        const calls: { sql: string; params: unknown[] }[] = [];
        const backend = await initializeRebaseBackend({
            app: new Hono<HonoEnv>(),
            server: idleServer(),
            collections: [collection("posts")],
            cronPersistence: false,
            bootstrappers: [bootstrapperFor(calls)],
            storage: { type: "local", basePath: root },
            jobs: { enabled: true, tasks: {} },
            ...(options.admin ? {} : { surfaces: { auth: false, data: false, storage: false, admin: false, functions: false, cron: false, meta: false, realtime: false } })
        });
        started.push(backend);
        calls.length = 0;
        await backend.jobQueue!.runOnce();
        const claim = calls.find(call => /UPDATE rebase\.jobs SET\s+status = 'running'/.test(call.sql));
        return claim?.params ?? [];
    }

    it("is registered on a process serving the admin surface", async () => {
        expect(await claimedTasks({ admin: true })).toContain(STORAGE_ORPHANS_TASK);
    });

    it("is registered on a worker, which serves no admin surface", async () => {
        expect(await claimedTasks({ admin: false })).toContain(STORAGE_ORPHANS_TASK);
    });
});
