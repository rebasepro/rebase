import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
/**
 * `GET /file/*` streams, and reads only what it sends.
 *
 * It used to read every object whole before deciding anything: a 50 MB video
 * on S3 was downloaded and held three or four times for each `Range` request a
 * `<video>` makes on load and on every seek, for each `If-None-Match`
 * revalidation that ends in a 304, and for each thumbnail whose rendition was
 * already cached. These assertions do not measure memory — they pin what makes
 * the memory constant: which reads the route asks the controller for.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Hono } from "hono";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createStorageRoutes } from "../src/storage/routes";
import { configureJwt } from "../src/auth/jwt";
import { LocalStorageController } from "../src/storage/LocalStorageController";
import { S3StorageController } from "../src/storage/S3StorageController";
import * as imageTransform from "../src/storage/image-transform";
import type { StorageController, StoredObjectInfo, StoredObjectRange, StoredObjectStream } from "../src/storage/types";

const OBJECT = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251));
const LAST_MODIFIED = 1_700_000_000_000;

/** A controller with the streamed reads, over one in-memory object, counting what it is asked. */
function streamingController(contentType = "video/mp4") {
    let version = { size: OBJECT.byteLength, lastModified: LAST_MODIFIED };
    const calls = { statObject: 0, getObjectStream: [] as (StoredObjectRange | undefined)[], getObject: 0 };
    const info = (): StoredObjectInfo => ({ ...version, contentType });
    const controller: StorageController = {
        putObject: async () => { throw new Error("not used"); },
        getSignedUrl: async () => ({ url: null }),
        deleteObject: async () => undefined,
        listObjects: async () => ({ items: [], prefixes: [] }),
        getType: () => "memory",
        getObject: async () => {
            calls.getObject++;
            return new File([OBJECT], "clip.mp4", { type: contentType, lastModified: version.lastModified });
        },
        statObject: async () => {
            calls.statObject++;
            return info();
        },
        getObjectStream: async (_key: string, options?: { bucket?: string; range?: StoredObjectRange }): Promise<StoredObjectStream> => {
            calls.getObjectStream.push(options?.range);
            const bytes = options?.range ? OBJECT.subarray(options.range.start, options.range.end + 1) : OBJECT;
            return {
                ...info(),
                stream: new Blob([bytes]).stream(),
                ...(options?.range ? { range: options.range } : {})
            };
        }
    };
    return { controller, calls, replace: (next: typeof version) => { version = next; } };
}

function appFor(controller: StorageController): Hono<HonoEnv> {
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/api/storage", createStorageRoutes({ controller, requireAuth: false }));
    return app;
}

const fileUrl = "http://localhost/api/storage/file/media/clip.mp4";

describe("GET /file/* on a controller with streamed reads", () => {
    beforeEach(() => {
        configureJwt({ secret: "test-secret-key-for-jwt-testing-1234567890" });
    });
    afterEach(() => jest.restoreAllMocks());

    it("asks the store for the range only, and never for the whole object", async () => {
        const { controller, calls } = streamingController();

        const res = await appFor(controller).fetch(new Request(fileUrl, { headers: { Range: "bytes=100-1123" } }));

        expect(res.status).toBe(206);
        expect(Buffer.from(await res.arrayBuffer()).equals(OBJECT.subarray(100, 1124))).toBe(true);
        expect(res.headers.get("Content-Range")).toBe(`bytes 100-1123/${OBJECT.byteLength}`);
        expect(res.headers.get("Content-Length")).toBe("1024");
        expect(calls.getObjectStream).toEqual([{ start: 100, end: 1123 }]);
        expect(calls.getObject).toBe(0);
    });

    it("serves a plain GET from one streamed read", async () => {
        const { controller, calls } = streamingController();

        const res = await appFor(controller).fetch(new Request(fileUrl));

        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Length")).toBe(String(OBJECT.byteLength));
        expect(Buffer.from(await res.arrayBuffer()).equals(OBJECT)).toBe(true);
        expect(calls.getObjectStream).toEqual([undefined]);
        expect(calls.statObject).toBe(0);
        expect(calls.getObject).toBe(0);
    });

    it("answers a revalidation with a 304 without reading the object", async () => {
        const { controller, calls } = streamingController();
        const app = appFor(controller);
        const etag = (await app.fetch(new Request(fileUrl, { method: "HEAD" }))).headers.get("ETag")!;

        const res = await app.fetch(new Request(fileUrl, { headers: { "If-None-Match": etag } }));

        expect(res.status).toBe(304);
        expect(calls.getObjectStream).toEqual([]);
        expect(calls.getObject).toBe(0);
    });

    it("answers a HEAD from the description alone", async () => {
        const { controller, calls } = streamingController();

        const res = await appFor(controller).fetch(new Request(fileUrl, { method: "HEAD" }));

        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Length")).toBe(String(OBJECT.byteLength));
        expect(res.headers.get("Accept-Ranges")).toBe("bytes");
        expect(calls.getObjectStream).toEqual([]);
        expect(calls.getObject).toBe(0);
    });

    it("answers an unsatisfiable range without reading the object", async () => {
        const { controller, calls } = streamingController();

        const res = await appFor(controller).fetch(new Request(fileUrl, { headers: { Range: "bytes=999999-" } }));

        expect(res.status).toBe(416);
        expect(calls.getObjectStream).toEqual([]);
    });

    it("serves a cached rendition without reading a byte of the source", async () => {
        const { controller, calls } = streamingController("image/jpeg");
        const transform = jest.spyOn(imageTransform, "transformImage")
            .mockResolvedValue({ data: Buffer.from("rendition"), contentType: "image/webp" });
        const app = appFor(controller);
        const url = `${fileUrl}?width=300&format=webp`;

        await app.fetch(new Request(url));
        expect(calls.getObjectStream).toHaveLength(1);
        const res = await app.fetch(new Request(url));

        expect(res.status).toBe(200);
        expect(await res.text()).toBe("rendition");
        expect(transform).toHaveBeenCalledTimes(1);
        // The first request's miss read the source once; the hit read nothing.
        expect(calls.getObjectStream).toHaveLength(1);
        expect(calls.getObject).toBe(0);
    });

    it("serves the newer object whole when it was replaced between describing and reading it", async () => {
        const { controller, replace } = streamingController();
        const original = controller.statObject!.bind(controller);
        controller.statObject = async (key, bucket) => {
            const described = await original(key, bucket);
            replace({ size: OBJECT.byteLength, lastModified: LAST_MODIFIED + 5000 });
            return described;
        };

        const res = await appFor(controller).fetch(new Request(fileUrl, { headers: { Range: "bytes=0-9" } }));

        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Length")).toBe(String(OBJECT.byteLength));
        expect(res.headers.get("Content-Range")).toBeNull();
        expect(res.headers.get("ETag")).toContain((LAST_MODIFIED + 5000).toString(16));
        expect(Buffer.from(await res.arrayBuffer()).equals(OBJECT)).toBe(true);
    });
});

describe("the built-in controllers' streamed reads", () => {
    it("S3: a range is a ranged GetObject, handed on as a stream", async () => {
        const sent: { name: string; input: Record<string, unknown> }[] = [];
        const s3 = new S3StorageController({ type: "s3", bucket: "b", accessKeyId: "x", secretAccessKey: "y" });
        Object.defineProperty(s3, "_client", {
            value: {
                send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
                    sent.push({ name: command.constructor.name, input: command.input });
                    async function* body() { yield OBJECT.subarray(10, 20); }
                    return {
                        Body: body(),
                        ContentType: "video/mp4",
                        ContentLength: 10,
                        ContentRange: `bytes 10-19/${OBJECT.byteLength}`,
                        LastModified: new Date(LAST_MODIFIED)
                    };
                }
            }
        });

        const result = await s3.getObjectStream("clip.mp4", { range: { start: 10, end: 19 } });

        expect(sent).toEqual([{ name: "GetObjectCommand", input: { Bucket: "b", Key: "clip.mp4", Range: "bytes=10-19" } }]);
        expect(result!.stream).toBeInstanceOf(ReadableStream);
        expect(result!.size).toBe(OBJECT.byteLength);
        expect(result!.range).toEqual({ start: 10, end: 19 });
        expect(Buffer.from(await new Response(result!.stream).arrayBuffer()).equals(OBJECT.subarray(10, 20))).toBe(true);
    });

    it("S3: describing an object is a HEAD, not a GET", async () => {
        const sent: string[] = [];
        const s3 = new S3StorageController({ type: "s3", bucket: "b", accessKeyId: "x", secretAccessKey: "y" });
        Object.defineProperty(s3, "_client", {
            value: {
                send: async (command: { constructor: { name: string } }) => {
                    sent.push(command.constructor.name);
                    return { ContentLength: 5, ContentType: "image/png", LastModified: new Date(LAST_MODIFIED) };
                }
            }
        });

        expect(await s3.statObject("a.png")).toEqual({ size: 5, contentType: "image/png", lastModified: LAST_MODIFIED });
        expect(sent).toEqual(["HeadObjectCommand"]);
    });

    describe("local", () => {
        let dir: string;
        beforeEach(async () => {
            dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-stream-"));
        });
        afterEach(async () => {
            await fs.promises.rm(dir, { recursive: true, force: true });
        });

        it("reads a range from disk as a stream", async () => {
            const local = new LocalStorageController({ type: "local", basePath: dir });
            await local.putObject({ file: new File([OBJECT], "clip.mp4", { type: "video/mp4" }), key: "clip.mp4" });

            const result = await local.getObjectStream("clip.mp4", { range: { start: 7, end: 15 } });

            expect(result!.stream).toBeInstanceOf(ReadableStream);
            expect(result!.size).toBe(OBJECT.byteLength);
            expect(result!.contentType).toBe("video/mp4");
            expect(Buffer.from(await new Response(result!.stream).arrayBuffer()).equals(OBJECT.subarray(7, 16))).toBe(true);
            expect(await local.getObjectStream("missing.mp4")).toBeNull();
        });

        it("serves a file through the route without reading it whole", async () => {
            const local = new LocalStorageController({ type: "local", basePath: dir });
            await local.putObject({ file: new File([OBJECT], "clip.mp4", { type: "video/mp4" }), key: "media/clip.mp4" });
            const readFile = jest.spyOn(fs.promises, "readFile");

            const res = await appFor(local).fetch(new Request(fileUrl));

            expect(Buffer.from(await res.arrayBuffer()).equals(OBJECT)).toBe(true);
            // The sidecar is read; the object never is.
            expect(readFile.mock.calls.map(([p]) => String(p)).filter(p => !p.endsWith(".metadata.json"))).toEqual([]);
        });
    });
});
