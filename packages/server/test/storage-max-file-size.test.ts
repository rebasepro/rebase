import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "@jest/globals";
/**
 * How large a file each storage source accepts, and that every door says the
 * same number.
 *
 * Three doors disagreed. `OPTIONS /tus` advertised `Tus-Max-Size: 5368709120`
 * and the docs said "up to 5GB"; `POST /tus` refused anything over 50 MB; and a
 * booted project had no setting that moved the 50 MB at all — the upload route
 * read `maxFileSize` only from a single-source config, and the boot path always
 * passes a map. A per-source `maxFileSize` in a hand-written map reached the
 * controller alone, whose refusal was a plain `Error`: a 500 on `/upload`, and a
 * 502 on TUS after the client had sent every byte.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { Hono } from "hono";
import type { BackendBootstrapper, InitializedDriver } from "@rebasepro/types";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { LocalStorageController } from "../src/storage/LocalStorageController";
import { DefaultStorageRegistry } from "../src/storage/storage-registry";
import { createStorageRoutes } from "../src/storage/routes";
import { resolveStorageBackend } from "../src/boot/sources";
import { initializeRebaseBackend } from "../src/init";
import { DEFAULT_MAX_FILE_SIZE } from "../src/storage/types";

const b64 = (s: string) => Buffer.from(s).toString("base64");

describe("STORAGE_MAX_FILE_SIZE", () => {
    it("sets the default source's limit, in bytes", () => {
        const config = resolveStorageBackend({ STORAGE_MAX_FILE_SIZE: "209715200" }, "(default)", undefined, "/var/uploads");
        expect(config?.maxFileSize).toBe(209715200);
    });

    it("sets a named source's limit with its suffix, and only that source's", () => {
        const env = {
            STORAGE_TYPE__MEDIA: "s3",
            S3_BUCKET__MEDIA: "media",
            S3_ACCESS_KEY_ID__MEDIA: "k",
            S3_SECRET_ACCESS_KEY__MEDIA: "s",
            STORAGE_MAX_FILE_SIZE__MEDIA: "1073741824"
        };
        expect(resolveStorageBackend(env, "media", undefined, "/var/uploads")?.maxFileSize).toBe(1073741824);
        expect(resolveStorageBackend(env, "(default)", undefined, "/var/uploads")?.maxFileSize).toBeUndefined();
    });

    it("leaves the limit to the controller's default when unset", () => {
        expect(resolveStorageBackend({}, "(default)", undefined, "/var/uploads")?.maxFileSize).toBeUndefined();
    });

    it.each(["abc", "0", "-5", "1.5", "10MB"])("refuses %s at boot, naming the variable", (value) => {
        expect(() => resolveStorageBackend({ STORAGE_MAX_FILE_SIZE__MEDIA: value }, "media", undefined, "/var/uploads"))
            .toThrow(/STORAGE_MAX_FILE_SIZE__MEDIA/);
    });
});

describe("one limit per source, on every door", () => {
    let root: string;
    let app: Hono<HonoEnv>;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-max-size-"));
        const registry = DefaultStorageRegistry.create({
            "(default)": new LocalStorageController({ type: "local", basePath: path.join(root, "a"), maxFileSize: 10 }),
            media: new LocalStorageController({ type: "local", basePath: path.join(root, "b"), maxFileSize: 20 })
        });
        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({ registry, requireAuth: false }));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    const tusMaxSize = async (query = "") =>
        (await app.request(`/api/storage/tus${query}`, { method: "OPTIONS" })).headers.get("Tus-Max-Size");

    const createTus = (length: number, storageId?: string) => app.request("/api/storage/tus", {
        method: "POST",
        headers: {
            "Tus-Resumable": "1.0.0",
            "Upload-Length": String(length),
            "Upload-Metadata": [`key ${b64("f.bin")}`, ...(storageId ? [`storageId ${b64(storageId)}`] : [])].join(",")
        }
    });

    const upload = (size: number, storageId?: string) => {
        const form = new FormData();
        form.append("file", new Blob([new Uint8Array(size)]), "f.bin");
        form.append("key", "f.bin");
        if (storageId) form.append("storageId", storageId);
        return app.request("/api/storage/upload", { method: "POST", body: form });
    };

    it("advertises each source's own limit in Tus-Max-Size", async () => {
        expect(await tusMaxSize()).toBe("10");
        expect(await tusMaxSize("?storageId=media")).toBe("20");
    });

    it("accepts a resumable upload exactly at the advertised limit, and refuses one byte more", async () => {
        expect((await createTus(10)).status).toBe(201);
        expect((await createTus(11)).status).toBe(413);
        expect((await createTus(20, "media")).status).toBe(201);
        expect((await createTus(21, "media")).status).toBe(413);
    });

    it("refuses an oversized multipart upload with 413, not 500", async () => {
        const over = await upload(15);
        expect(over.status).toBe(413);
        expect(await over.json()).toMatchObject({ error: { code: "PAYLOAD_TOO_LARGE" } });

        expect((await upload(15, "media")).status).toBe(201);
    });

    it("refuses with 413 even when the controller is the only one checking", async () => {
        // A write that reaches the controller with no route in front of it —
        // TUS finalize, the rendition cache — meets the same answer.
        const controller = new LocalStorageController({ type: "local", basePath: path.join(root, "c"), maxFileSize: 3 });
        await expect(controller.putObject({ file: new File(["four"], "x.txt"), key: "x.txt" }))
            .rejects.toMatchObject({ statusCode: 413, code: "PAYLOAD_TOO_LARGE" });
    });
});

describe("the upload body limit of a booted backend", () => {
    const MB = 1024 * 1024;
    let root: string;
    const originalNodeEnv = process.env.NODE_ENV;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-max-size-boot-"));
        process.env.NODE_ENV = "development";
    });

    afterAll(() => {
        fs.rmSync(root, { recursive: true, force: true });
        process.env.NODE_ENV = originalNodeEnv;
    });

    const bootstrapper = {
        type: "fake",
        isDefault: true,
        async initializeDriver(): Promise<InitializedDriver> {
            return { driver: {} as never, collections: [], internals: {} } as unknown as InitializedDriver;
        }
    } as unknown as BackendBootstrapper;

    const multipart = async (size: number, storageId?: string) => {
        const form = new FormData();
        form.append("file", new Blob([new Uint8Array(size)]), "big.bin");
        form.append("key", "big.bin");
        if (storageId) form.append("storageId", storageId);
        const encoded = new Response(form);
        const body = new Uint8Array(await encoded.arrayBuffer());
        return {
            method: "POST",
            body,
            headers: {
                "content-type": encoded.headers.get("content-type")!,
                "content-length": String(body.byteLength)
            }
        };
    };

    it("is the largest source's limit, and each source still holds its own", async () => {
        // The shape the boot path always passes: a map of sources. The body
        // limit used to read `maxFileSize` from a single-source config only, so
        // with a map it was always the 50 MB default whatever the sources said.
        const app = new Hono();
        await initializeRebaseBackend({
            app: app as never,
            server: {} as never,
            collections: [],
            bootstrappers: [bootstrapper],
            auth: {
                id: "signed-in",
                verifyRequest: async () => ({ uid: "editor-1", roles: ["editor"] }),
                getCapabilities: () => ({})
            },
            storage: {
                "(default)": { type: "local", basePath: path.join(root, "a"), maxFileSize: 2 * MB },
                media: { type: "local", basePath: path.join(root, "b"), maxFileSize: DEFAULT_MAX_FILE_SIZE + 5 * MB }
            }
        } as never);

        const toMedia = await app.request("/api/storage/upload", await multipart(DEFAULT_MAX_FILE_SIZE + MB, "media"));
        expect(toMedia.status).toBe(201);

        const toDefault = await app.request("/api/storage/upload", await multipart(3 * MB));
        expect(toDefault.status).toBe(413);

        const tooBigForAny = await app.request("/api/storage/upload", await multipart(DEFAULT_MAX_FILE_SIZE + 6 * MB, "media"));
        expect(tooBigForAny.status).toBe(413);
    });
});
