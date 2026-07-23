import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";
import { Hono } from "hono";
import type { BackendBootstrapper, InitializedDriver } from "@rebasepro/types";

import { initializeRebaseBackend } from "../src/init";

/**
 * What a deployment with no bucket does with an upload.
 *
 * The old answer was "writes it to the container filesystem and loses it on the
 * next redeploy". The new answer is "refuses it", and these tests pin the shape
 * of that refusal: it has to be reachable, self-explanatory, and permanent —
 * a 404 sends people debugging their client, and a 503 gets queued and retried
 * forever by the client's offline queue.
 */

function stubDriver() {
    return {
        fetchCollection: async () => ({ data: [], meta: { total: 0, hasMore: false } }),
        fetchEntity: async () => undefined,
        saveEntity: async () => ({}),
        deleteEntity: async () => undefined,
        countCollection: async () => 0,
        checkUniqueField: async () => true,
        healthCheck: async () => ({ healthy: true, latencyMs: 1 })
    } as never;
}

const bootstrapper = {
    type: "fake",
    isDefault: true,
    async initializeDriver(): Promise<InitializedDriver> {
        return { driver: stubDriver(), collections: [], internals: {} } as unknown as InitializedDriver;
    }
} as unknown as BackendBootstrapper;

async function boot(storage?: unknown) {
    const app = new Hono();
    await initializeRebaseBackend({
        app: app as never,
        server: {} as never,
        collections: [],
        bootstrappers: [bootstrapper],
        ...(storage === undefined ? {} : { storage })
    } as never);
    return app;
}

const originalNodeEnv = process.env.NODE_ENV;
const originalForce = process.env.FORCE_LOCAL_STORAGE;

beforeEach(() => {
    delete process.env.FORCE_LOCAL_STORAGE;
});

afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalForce === undefined) delete process.env.FORCE_LOCAL_STORAGE;
    else process.env.FORCE_LOCAL_STORAGE = originalForce;
});

describe("storage routes with no backend configured", () => {
    it("answers an upload with 501 STORAGE_NOT_CONFIGURED, not 404", async () => {
        process.env.NODE_ENV = "development";
        const app = await boot(undefined);

        const res = await app.request("/api/storage/upload", { method: "POST" });

        expect(res.status).toBe(501);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("STORAGE_NOT_CONFIGURED");
    });

    it("names the fix in the message", async () => {
        process.env.NODE_ENV = "development";
        const app = await boot(undefined);

        const body = await (await app.request("/api/storage/upload", { method: "POST" })).json();

        expect((body as { error: { message: string } }).error.message).toMatch(/STORAGE_TYPE/);
    });

    it("refuses uploads in production when only local storage was configured", async () => {
        // The cloud case: nothing is set, the scaffolded backend falls through
        // to local disk, and the pod's filesystem is erased on every redeploy.
        // Storage is off rather than quietly ephemeral.
        process.env.NODE_ENV = "production";
        const app = await boot({ type: "local", basePath: "/tmp/rebase-storage-disabled-test" });

        const res = await app.request("/api/storage/upload", { method: "POST" });

        expect(res.status).toBe(501);
    });

    it("still serves storage in development, where local disk is the point", async () => {
        process.env.NODE_ENV = "development";
        const app = await boot({ type: "local", basePath: "/tmp/rebase-storage-disabled-test" });

        // Mounted, so anything but a 501/404: an unauthenticated upload is
        // rejected by the auth guard, which is a different failure entirely.
        const res = await app.request("/api/storage/upload", { method: "POST" });

        expect(res.status).not.toBe(501);
        expect(res.status).not.toBe(404);
    });
});
