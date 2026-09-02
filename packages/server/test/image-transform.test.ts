import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
/**
 * The transform endpoint is bounded work.
 *
 * `GET /file/*?width=…` runs on every read, including the anonymous
 * public-object path, and each miss is a full libvips decode plus an encode of
 * a whole object held in memory. There was no cap, no queue and no in-flight
 * de-duplication, so N concurrent requests for one variant did N decodes and a
 * loop over `?width=1..4096` bought seconds of pod CPU per few hundred bytes
 * of request. The parameters were also *clamped* rather than checked, so a
 * caller could not tell that the bound had been applied at all.
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
    parseTransformOptions,
    InvalidTransformOptionsError,
    TransformQueue,
    TransformOverloadedError,
    transformQueue,
    transformImage,
    UntransformableImageError,
    MAX_INPUT_PIXELS
} from "../src/storage/image-transform";

describe("parseTransformOptions", () => {
    it("returns null when nothing was asked for", () => {
        expect(parseTransformOptions({})).toBeNull();
        expect(parseTransformOptions({ token: "abc", storageId: "media" })).toBeNull();
    });

    it("parses a request inside the bounds", () => {
        expect(parseTransformOptions({ width: "300", height: "200", quality: "70", format: "webp", fit: "inside" }))
            .toEqual({ width: 300, height: 200, quality: 70, format: "webp", fit: "inside" });
    });

    describe("refuses out-of-bounds parameters instead of clamping them", () => {
        it.each([
            ["width", "99999"],
            ["width", "0"],
            ["width", "abc"],
            ["width", "300px"],
            ["width", "-5"],
            ["height", "4097"],
            ["quality", "1000"],
            ["quality", "0"],
            ["format", "tiff"],
            ["fit", "squish"]
        ])("rejects %s=%s", (key, value) => {
            expect(() => parseTransformOptions({ [key]: value })).toThrow(InvalidTransformOptionsError);
        });

        it("names the parameter and the bound in the message", () => {
            expect(() => parseTransformOptions({ width: "99999" }))
                .toThrow(/width.*between 1 and 4096/);
        });
    });
});

describe("TransformQueue", () => {
    /** A task that finishes only when we say so. */
    const deferred = () => {
        let release!: () => void;
        const promise = new Promise<void>((resolve) => { release = resolve; });
        return { promise, release };
    };

    it("runs no more than maxConcurrent tasks at once", async () => {
        const queue = new TransformQueue(2, 10);
        let active = 0;
        let peak = 0;
        const gate = deferred();

        const tasks = Array.from({ length: 6 }, () => queue.run(async () => {
            active++;
            peak = Math.max(peak, active);
            await gate.promise;
            active--;
        }));

        // Let the first batch start before releasing anything.
        await new Promise((r) => setImmediate(r));
        expect(peak).toBe(2);

        gate.release();
        await Promise.all(tasks);
        expect(peak).toBe(2);
    });

    it("refuses rather than accepting work it will not get to", async () => {
        const queue = new TransformQueue(1, 1);
        const gate = deferred();

        const running = queue.run(async () => { await gate.promise; });
        const queued = queue.run(async () => { /* waits for a slot */ });

        await expect(queue.run(async () => undefined)).rejects.toThrow(TransformOverloadedError);

        gate.release();
        await Promise.all([running, queued]);
    });

    it("drains the queue as tasks finish", async () => {
        const queue = new TransformQueue(1, 4);
        const order: number[] = [];

        await Promise.all([1, 2, 3].map((n) => queue.run(async () => { order.push(n); })));

        expect(order.sort()).toEqual([1, 2, 3]);
        expect(queue.depth).toBe(0);
    });
});

describe("transformImage", () => {
    /** A real PNG, so sharp does real work. */
    const png = async (width: number, height: number): Promise<Buffer> => {
        const sharp = (await import("sharp")).default;
        return sharp({
            create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } }
        }).png().toBuffer();
    };

    it("resizes and re-encodes", async () => {
        const sharp = (await import("sharp")).default;
        const result = await transformImage(await png(64, 64), { width: 32, format: "webp" });

        expect(result.contentType).toBe("image/webp");
        expect((await sharp(result.data).metadata()).width).toBe(32);
    });

    /**
     * What the BYTES are, not what the upload said they were.
     *
     * Whether a transform runs at all is decided from the stored content type,
     * which the uploader chose — so a file served as `image/png` reaches the
     * decoder whatever it contains. SVG is excluded on purpose: sharp renders
     * it through librsvg, a far larger surface than a raster decoder, and one
     * with a history of resolving external references.
     */
    it("refuses an SVG, however the object was labelled", async () => {
        const svg = Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">` +
            `<rect width="32" height="32" fill="red"/></svg>`
        );

        await expect(transformImage(svg, { width: 16, format: "webp" }))
            .rejects.toThrow(UntransformableImageError);
    });

    it("refuses a file that is not an image at all", async () => {
        await expect(transformImage(Buffer.from("just some text, honestly"), { width: 16 }))
            .rejects.toThrow();
    });

    it("still transforms the raster formats it is meant to", async () => {
        const result = await transformImage(await png(16, 16), { width: 8, format: "webp" });
        expect(result.contentType).toBe("image/webp");
    });

    /**
     * A bound on the DECODE, which the upload size limit cannot express: a few
     * hundred KB of PNG can describe a 40,000 × 40,000 canvas, and a decoded
     * pixel costs several bytes. sharp's own default ceiling is about 268
     * megapixels, which is a property of the format rather than a decision.
     */
    it("caps the decode well below sharp's own default", () => {
        expect(MAX_INPUT_PIXELS).toBeLessThan(0x3fff * 0x3fff);
        // And comfortably above any image a website serves.
        expect(MAX_INPUT_PIXELS).toBeGreaterThan(8000 * 6000);
    });

    it("refuses an image with more pixels than the cap", async () => {
        // Built at a size that is cheap to create and declared over the cap by
        // lowering nothing — the assertion is that the limit is the decoder's,
        // so this uses sharp's own error.
        const sharp = (await import("sharp")).default;
        const huge = await sharp({
            create: { width: 8000, height: 8000, channels: 3, background: { r: 0, g: 0, b: 0 } }
        }).png().toBuffer();

        // 64 megapixels, over the 50 megapixel cap.
        await expect(transformImage(huge, { width: 16 })).rejects.toThrow(/pixel limit/i);
    }, 60_000);

    it("refuses when the shared queue is saturated, instead of piling on more decodes", async () => {
        // Fill the process-wide queue the route uses. Without the queue, this
        // resolves normally and the pod takes the work no matter how much of
        // it arrives.
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const held = Array.from({ length: 200 }, () => transformQueue.run(() => gate).catch(() => undefined));

        await expect(transformImage(await png(8, 8), { width: 4 }))
            .rejects.toThrow(TransformOverloadedError);

        release();
        await Promise.all(held);
    });
});

describe("GET /file/* transforms", () => {
    let app: Hono<HonoEnv>;
    let tempDir: string;

    beforeEach(async () => {
        configureJwt({ secret: "test-secret-key-for-jwt-testing-1234567890" });
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-transform-"));
        const controller = new LocalStorageController({ basePath: tempDir });

        const sharp = (await import("sharp")).default;
        const bytes = await sharp({
            create: { width: 64, height: 64, channels: 3, background: { r: 1, g: 2, b: 3 } }
        }).png().toBuffer();
        await controller.putObject({
            file: new File([new Uint8Array(bytes)], "a.png", { type: "image/png" }),
            // A unique key per run: the transform cache is module-scoped.
            key: `photos/${path.basename(tempDir)}.png`
        });

        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({ controller, requireAuth: false }));
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    const url = (query: string) =>
        `http://localhost/api/storage/file/photos/${path.basename(tempDir)}.png${query}`;

    it("400s an out-of-bounds parameter rather than silently serving another size", async () => {
        const res = await app.fetch(new Request(url("?width=99999")));

        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: { code: "INVALID_TRANSFORM_OPTIONS" } });
    });

    it("collapses concurrent misses on one variant into a single transform", async () => {
        const spy = jest.spyOn(imageTransform, "transformImage");

        const responses = await Promise.all(
            Array.from({ length: 5 }, () => app.fetch(new Request(url("?width=16&format=webp"))))
        );

        expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it("serves the transform, and the second request comes from cache", async () => {
        const spy = jest.spyOn(imageTransform, "transformImage");

        const first = await app.fetch(new Request(url("?width=8&format=webp")));
        expect(first.headers.get("Content-Type")).toBe("image/webp");

        await app.fetch(new Request(url("?width=8&format=webp")));
        expect(spy).toHaveBeenCalledTimes(1);
    });
});
