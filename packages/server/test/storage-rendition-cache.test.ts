import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
/**
 * Renditions that outlive the process that computed them.
 *
 * The in-memory LRU makes a transform free for the second request that reaches
 * the same instance. Everything else pays full price: a second replica, a
 * replica added under load, and every replica after every deploy. Writing the
 * rendition back to the storage source is what makes "computed once" true
 * across all three.
 *
 * The tests that matter here are the ones a reader would not assume:
 *
 *  - a *different router* — standing in for another instance, or the same one
 *    after a restart — serves the variant without re-encoding it;
 *  - replacing the source object does not serve the old rendition;
 *  - a bucket that refuses the write still serves the image;
 *  - the reserved prefix is not addressable by a caller, in either direction.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Hono } from "hono";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { LocalStorageController } from "../src/storage/LocalStorageController";
import { createStorageRoutes } from "../src/storage/routes";
import { configureJwt } from "../src/auth/jwt";
import * as imageTransform from "../src/storage/image-transform";
import {
    RENDITION_PREFIX,
    isRenditionKey,
    renditionKey,
    renditionKeyCandidates,
    createDurableRenditionCache
} from "../src/storage/rendition-cache";
import type { StorageController } from "../src/storage/types";

describe("rendition keys", () => {
    it("puts every rendition under the one reserved prefix", () => {
        expect(renditionKey("photos/a.png@v1::{}", "image/webp").startsWith(RENDITION_PREFIX)).toBe(true);
        expect(isRenditionKey(renditionKey("k", "image/png"))).toBe(true);
    });

    it("names the file by its format, so a bucket listing is readable", () => {
        expect(renditionKey("k", "image/webp").endsWith(".webp")).toBe(true);
        expect(renditionKey("k", "image/jpeg").endsWith(".jpg")).toBe(true);
    });

    it("gives one cache key one name, and two keys two", () => {
        expect(renditionKey("a", "image/webp")).toBe(renditionKey("a", "image/webp"));
        expect(renditionKey("a", "image/webp")).not.toBe(renditionKey("b", "image/webp"));
    });

    it("tries the requested format first when reading", () => {
        const [first] = renditionKeyCandidates("k", "image/avif");
        expect(first.endsWith(".avif")).toBe(true);
    });

    it("does not read a key from outside the reserved space", () => {
        expect(renditionKeyCandidates("../../etc/passwd").every(isRenditionKey)).toBe(true);
    });
});

describe("createDurableRenditionCache", () => {
    const rendition = { data: Buffer.from("bytes"), contentType: "image/webp" };

    /** A controller whose writes fail, as read-only bucket credentials do. */
    const readOnly = (): StorageController => ({
        putObject: async () => { throw new Error("AccessDenied"); },
        getObject: async () => null,
        getSignedUrl: async () => ({ url: null }),
        deleteObject: async () => undefined,
        listObjects: async () => ({ items: [] }),
        getType: () => "s3"
    } as unknown as StorageController);

    it("swallows a failed write rather than failing the request behind it", async () => {
        const cache = createDurableRenditionCache();

        await expect(cache.put(readOnly(), "k", undefined, rendition)).resolves.toBeUndefined();
    });

    it("treats an unreachable bucket as a miss, not an error", async () => {
        const cache = createDurableRenditionCache();
        const broken = {
            getObject: async () => { throw new Error("connection reset"); }
        } as unknown as StorageController;

        await expect(cache.get(broken, "k", undefined)).resolves.toBeNull();
    });
});

describe("GET /file/* with a durable rendition cache", () => {
    let tempDir: string;
    let controller: LocalStorageController;
    let sourceKey: string;

    /** A fresh router over the same bucket: another instance, or a restart. */
    const routerOn = (enabled: boolean): Hono<HonoEnv> => {
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({
            controller,
            requireAuth: false,
            renditionCache: { enabled }
        }));
        return app;
    };

    const png = async (r: number): Promise<Buffer> => {
        const sharp = (await import("sharp")).default;
        return sharp({ create: { width: 64, height: 64, channels: 3, background: { r, g: 2, b: 3 } } })
            .png()
            .toBuffer();
    };

    const url = (query: string) => `http://localhost/api/storage/file/${sourceKey}${query}`;

    beforeEach(async () => {
        configureJwt({ secret: "test-secret-key-for-jwt-testing-1234567890" });
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-rendition-"));
        controller = new LocalStorageController({ basePath: tempDir });
        // Unique per run. The in-memory cache is per router, but the *durable*
        // one is the bucket, and these tests share a process — a shared key
        // would let one test's rendition answer another's question.
        sourceKey = `photos/${path.basename(tempDir)}.png`;
        await controller.putObject({
            file: new File([new Uint8Array(await png(1))], "a.png", { type: "image/png" }),
            key: sourceKey
        });
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    it("serves a second instance's request without re-encoding", async () => {
        await routerOn(true).fetch(new Request(url("?width=16&format=webp")));

        // Spied only now: the first router's work is what we want to reuse, and
        // the count must be of the *second* router's decisions.
        const spy = jest.spyOn(imageTransform, "transformImage");
        const response = await routerOn(true).fetch(new Request(url("?width=16&format=webp")));

        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe("image/webp");
        expect(spy).not.toHaveBeenCalled();
    });

    it("without it, the second instance does the work again", async () => {
        // The behaviour this feature exists to change, pinned so that "it was
        // already fine" cannot quietly become the explanation.
        await routerOn(false).fetch(new Request(url("?width=17&format=webp")));

        const spy = jest.spyOn(imageTransform, "transformImage");
        await routerOn(false).fetch(new Request(url("?width=17&format=webp")));

        expect(spy).toHaveBeenCalledTimes(1);
    });

    it("writes the rendition into the source bucket, under the reserved prefix", async () => {
        await routerOn(true).fetch(new Request(url("?width=18&format=webp")));

        const listed = await controller.listObjects(RENDITION_PREFIX);
        expect(listed.items.length).toBe(1);
        expect(listed.items[0].name.endsWith(".webp")).toBe(true);
    });

    it("does not serve the old rendition after the source is replaced", async () => {
        // The cache key carries the source's size and mtime, so this is a
        // different rendition rather than a stale one — the failure mode being
        // pinned is a replaced image staying invisible for as long as the cache
        // lives, which for a durable cache is forever.
        await routerOn(true).fetch(new Request(url("?width=19&format=webp")));

        const replacement = await png(250);
        await new Promise(resolve => setTimeout(resolve, 1100));
        await controller.putObject({
            file: new File([new Uint8Array(replacement)], "a.png", { type: "image/png" }),
            key: sourceKey
        });

        const spy = jest.spyOn(imageTransform, "transformImage");
        const response = await routerOn(true).fetch(new Request(url("?width=19&format=webp")));

        expect(response.status).toBe(200);
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it("still serves the image when the bucket refuses the write", async () => {
        const refusing = Object.create(controller) as LocalStorageController;
        Object.defineProperty(refusing, "putObject", {
            value: async () => { throw new Error("AccessDenied"); }
        });

        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({
            controller: refusing,
            requireAuth: false,
            renditionCache: { enabled: true }
        }));

        const response = await app.fetch(new Request(url("?width=20&format=webp")));

        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe("image/webp");
    });

    it("refuses to read the reserved prefix directly", async () => {
        // A rendition is a derivative of a source object, and every access rule
        // in the product is written against the *source* key. Serving one under
        // its own path would answer a question nobody was asked.
        await routerOn(true).fetch(new Request(url("?width=21&format=webp")));
        const [stored] = (await controller.listObjects(RENDITION_PREFIX)).items;
        const storedKey = `${RENDITION_PREFIX}${stored.name}`;

        const response = await routerOn(true)
            .fetch(new Request(`http://localhost/api/storage/file/${storedKey}`));

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: { code: "INVALID_STORAGE_KEY" } });
    });

    it("refuses to write into the reserved prefix", async () => {
        const form = new FormData();
        form.append("file", new File([new Uint8Array([1, 2, 3])], "x.webp", { type: "image/webp" }));
        form.append("key", `${RENDITION_PREFIX}anything.webp`);

        const response = await routerOn(true).fetch(new Request("http://localhost/api/storage/upload", {
            method: "POST",
            body: form
        }));

        expect(response.status).toBe(400);
    });
});
