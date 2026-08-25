import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
/**
 * Storage triggers: what fires, what does not, and what a failure costs.
 *
 * The three things worth pinning are not the happy path:
 *
 *  - a trigger fires for the *resumable* path too. Wiring one only to
 *    `POST /upload` would miss exactly the uploads big enough to be worth
 *    reacting to;
 *  - a handler that throws does not fail the request. The object is already
 *    stored by then, and answering with an error tells the client to repeat a
 *    write that succeeded;
 *  - internal writes — the image-rendition cache — do not fire anything. A
 *    trigger on `**` that fired on renditions would recurse.
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
import {
    compileStorageTriggers,
    StorageTriggerError,
    type StorageEventContext,
    type StorageTrigger
} from "../src/storage/triggers";

describe("compileStorageTriggers", () => {
    const noop = () => undefined;
    const fire = (
        triggers: StorageTrigger[],
        over: Partial<Omit<StorageEventContext, "params">> = {}
    ) => compileStorageTriggers(triggers)({
        event: "finalize",
        key: "uploads/alice/photo.png",
        storageId: "(default)",
        at: "2026-01-01T00:00:00.000Z",
        ...over
    });

    it("refuses a trigger with no handler at compile time, not at the first upload", () => {
        expect(() => compileStorageTriggers([{ path: "**" } as unknown as StorageTrigger]))
            .toThrow(StorageTriggerError);
    });

    it("refuses `**` anywhere but last, because it would match nothing quietly", () => {
        expect(() => compileStorageTriggers([{ path: "a/**/b", handler: noop }]))
            .toThrow(/only allowed as the last segment/);
    });

    it("refuses an event name that is not one", () => {
        expect(() => compileStorageTriggers([
            { path: "**", events: ["created"] as never, handler: noop }
        ])).toThrow(/not a storage event/);
    });

    it("refuses an empty `events`, which would silently never fire", () => {
        expect(() => compileStorageTriggers([{ path: "**", events: [], handler: noop }]))
            .toThrow(/never fires/);
    });

    it("passes the captured segments to the handler", async () => {
        const seen: StorageEventContext[] = [];
        await fire([{ path: "uploads/:uid/:file", handler: ctx => { seen.push(ctx); } }]);

        expect(seen).toHaveLength(1);
        expect(seen[0].params).toEqual({ uid: "alice", file: "photo.png" });
    });

    it("does not fire a trigger whose pattern does not match", async () => {
        const handler = jest.fn();
        await fire([{ path: "documents/**", handler }]);

        expect(handler).not.toHaveBeenCalled();
    });

    it("defaults to `finalize` only, so a delete does not run an upload's handler", async () => {
        const handler = jest.fn();
        await fire([{ path: "**", handler }], { event: "delete" });

        expect(handler).not.toHaveBeenCalled();
    });

    it("fires on delete when asked to", async () => {
        const handler = jest.fn();
        await fire([{ path: "**", events: ["delete"], handler }], { event: "delete" });

        expect(handler).toHaveBeenCalledTimes(1);
    });

    it("runs every matching trigger, in declaration order", async () => {
        const order: string[] = [];
        await fire([
            { path: "**", handler: () => { order.push("first"); } },
            { path: "uploads/**", handler: () => { order.push("second"); } }
        ]);

        expect(order).toEqual(["first", "second"]);
    });

    it("keeps going after one handler throws, and never rethrows", async () => {
        const after = jest.fn();
        await expect(fire([
            { path: "**", handler: () => { throw new Error("boom"); } },
            { path: "**", handler: after }
        ])).resolves.toBeUndefined();

        expect(after).toHaveBeenCalledTimes(1);
    });

    it("awaits an async handler rather than letting it outlive the request", async () => {
        let finished = false;
        await fire([{
            path: "**",
            handler: async () => {
                await new Promise(resolve => setTimeout(resolve, 10));
                finished = true;
            }
        }]);

        expect(finished).toBe(true);
    });
});

describe("storage routes fire triggers", () => {
    let app: Hono<HonoEnv>;
    let controller: LocalStorageController;
    let tempDir: string;
    let events: StorageEventContext[];

    const upload = async (key: string, type = "image/png") => {
        const form = new FormData();
        form.append("file", new File([new Uint8Array([1, 2, 3, 4])], path.basename(key), { type }));
        form.append("key", key);
        return app.fetch(new Request("http://localhost/api/storage/upload", { method: "POST", body: form }));
    };

    beforeEach(async () => {
        configureJwt({ secret: "test-secret-key-for-jwt-testing-1234567890" });
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-triggers-"));
        controller = new LocalStorageController({ basePath: tempDir });
        events = [];

        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({
            controller,
            requireAuth: false,
            renditionCache: { enabled: true },
            triggers: [
                { path: "**", events: ["finalize", "delete"], handler: ctx => { events.push(ctx); } }
            ]
        }));
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    it("fires finalize after a multipart upload, with the object's own details", async () => {
        expect((await upload("uploads/alice/a.png")).status).toBe(201);

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            event: "finalize",
            key: "uploads/alice/a.png",
            size: 4,
            contentType: "image/png",
            storageId: "(default)"
        });
    });

    it("fires delete after the object is gone", async () => {
        await upload("uploads/alice/b.png");
        events.length = 0;

        const response = await app.fetch(new Request(
            "http://localhost/api/storage/file/uploads/alice/b.png",
            { method: "DELETE" }
        ));

        expect(response.status).toBe(200);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ event: "delete", key: "uploads/alice/b.png" });
    });

    it("does not fire for a rendition the transform cache wrote", async () => {
        // A `**` trigger sees every key a caller can name. The rendition cache
        // writes straight to the controller, on purpose: a trigger firing on a
        // derived object is a trigger firing on its own output.
        const sharp = (await import("sharp")).default;
        const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 1, g: 2, b: 3 } } })
            .png().toBuffer();
        await controller.putObject({
            file: new File([new Uint8Array(png)], "c.png", { type: "image/png" }),
            key: "uploads/alice/c.png"
        });
        events.length = 0;

        const response = await app.fetch(new Request(
            "http://localhost/api/storage/file/uploads/alice/c.png?width=8&format=webp"
        ));

        expect(response.status).toBe(200);
        expect(events).toEqual([]);
    });

    it("still stores the object when a handler throws", async () => {
        const throwing = new Hono<HonoEnv>();
        throwing.onError(errorHandler);
        throwing.route("/api/storage", createStorageRoutes({
            controller,
            requireAuth: false,
            triggers: [{ path: "**", handler: () => { throw new Error("handler exploded"); } }]
        }));

        const form = new FormData();
        form.append("file", new File([new Uint8Array([9])], "d.png", { type: "image/png" }));
        form.append("key", "uploads/alice/d.png");
        const response = await throwing.fetch(new Request(
            "http://localhost/api/storage/upload",
            { method: "POST", body: form }
        ));

        expect(response.status).toBe(201);
        expect(await controller.getObject("uploads/alice/d.png")).not.toBeNull();
    });

    it("fires once for a resumable upload, when the last chunk lands", async () => {
        const body = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
        const create = await app.fetch(new Request("http://localhost/api/storage/tus", {
            method: "POST",
            headers: {
                "Tus-Resumable": "1.0.0",
                "Upload-Length": String(body.byteLength),
                "Upload-Metadata": `key ${Buffer.from("uploads/alice/big.bin").toString("base64")},` +
                    `contentType ${Buffer.from("application/octet-stream").toString("base64")}`
            }
        }));
        expect(create.status).toBe(201);
        const id = new URL(create.headers.get("Location")!).pathname.split("/").pop()!;

        // Two chunks, because the interesting question is whether the trigger
        // fires per chunk or per upload.
        for (const [offset, chunk] of [[0, body.slice(0, 4)], [4, body.slice(4)]] as const) {
            const patch = await app.fetch(new Request(`http://localhost/api/storage/tus/${id}`, {
                method: "PATCH",
                headers: {
                    "Tus-Resumable": "1.0.0",
                    "Upload-Offset": String(offset),
                    "Content-Type": "application/offset+octet-stream"
                },
                body: chunk
            }));
            expect(patch.status).toBe(204);
        }

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            event: "finalize",
            key: "uploads/alice/big.bin",
            size: 8
        });
    });
});
