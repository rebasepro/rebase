import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";
import { Hono } from "hono";
import type { BackendBootstrapper, InitializedDriver } from "@rebasepro/types";

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { initializeRebaseBackend } from "../src/init";
import { LocalStorageController } from "../src/storage/LocalStorageController";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";

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

async function boot(storage?: unknown, extra: Record<string, unknown> = {}) {
    const app = new Hono();
    await initializeRebaseBackend({
        app: app as never,
        server: {} as never,
        collections: [],
        bootstrappers: [bootstrapper],
        ...(storage === undefined ? {} : { storage }),
        ...extra
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

/**
 * Production drops a `local` default and keeps the named buckets — that is the
 * point of dropping rather than crashing. But the HTTP surface was mounted only
 * when a *default* controller existed, so a project that declared `bucket()`
 * alongside `bucket("media", { engine: "s3" })` and bound only media in
 * production served the whole-storage 501 stub: every admin upload to the
 * bucket that was configured was refused as if none were.
 */
describe("a production deployment whose local default was dropped", () => {
    let root: string;
    let mediaDir: string;

    const bootMedia = () => boot(
        {
            "(default)": { type: "local", basePath: path.join(root, "default") },
            // An instance rather than a config: production drops a `local`
            // *config*, and this stands in for the object store that survives.
            media: new LocalStorageController({ basePath: mediaDir })
        },
        { storageInsecureAllowAnyAuthenticated: true }
    );

    /** A signed-in caller, so what answers is the storage route and not the auth guard. */
    let authorization: string;

    const upload = (app: Hono, storageId?: string) => {
        const form = new FormData();
        form.append("file", new File(["hi"], "x.txt", { type: "text/plain" }));
        form.append("key", "x.txt");
        if (storageId) form.append("storageId", storageId);
        return app.request("/api/storage/upload", { method: "POST", body: form, headers: { authorization } });
    };

    const tusCreate = (app: Hono, storageId?: string) => app.request("/api/storage/tus", {
        method: "POST",
        headers: {
            authorization,
            "Tus-Resumable": "1.0.0",
            "Upload-Length": "2",
            "Upload-Metadata": [
                `key ${Buffer.from("t.txt").toString("base64")}`,
                ...(storageId ? [`storageId ${Buffer.from(storageId).toString("base64")}`] : [])
            ].join(",")
        }
    });

    // With no local default, TUS spools to `STORAGE_PATH || "./uploads"` —
    // relative to the cwd, which under jest is this package. Point it at the
    // scratch root, or every run leaves a `.tus-uploads` in the repository.
    const originalStoragePath = process.env.STORAGE_PATH;

    beforeEach(async () => {
        process.env.NODE_ENV = "production";
        configureJwt({ secret: "test-secret-key-for-jwt-testing-1234567890" });
        authorization = `Bearer ${await generateAccessToken("u1", [])}`;
        root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-dropped-default-"));
        mediaDir = path.join(root, "media");
        process.env.STORAGE_PATH = path.join(root, "spool");
    });

    afterEach(async () => {
        if (originalStoragePath === undefined) delete process.env.STORAGE_PATH;
        else process.env.STORAGE_PATH = originalStoragePath;
        await fs.promises.rm(root, { recursive: true, force: true });
    });

    it("serves the bucket that is bound", async () => {
        const app = await bootMedia();

        const res = await upload(app, "media");

        expect(res.status).toBe(201);
        expect(fs.existsSync(path.join(mediaDir, "default", "x.txt"))).toBe(true);
        expect((await tusCreate(app, "media")).status).toBe(201);
    });

    it("answers a request that names no source with 501 STORAGE_NOT_CONFIGURED, naming what is served", async () => {
        const app = await bootMedia();

        for (const res of [await upload(app), await tusCreate(app)]) {
            expect(res.status).toBe(501);
            const body = await res.json() as { error: { code: string; message: string } };
            expect(body.error.code).toBe("STORAGE_NOT_CONFIGURED");
            expect(body.error.message).toContain("\"media\"");
        }
    });

    it("lists the bound source", async () => {
        const app = await bootMedia();

        const res = await app.request("/api/storage/sources");

        expect(res.status).toBe(200);
        const body = await res.json() as { data: Array<{ key: string }> };
        expect(body.data.map(s => s.key)).toEqual(["media"]);
    });
});
