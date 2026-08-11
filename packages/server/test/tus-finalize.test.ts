import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { errorHandler } from "../src/api/errors";
import { TusHandler } from "../src/storage/tus-handler";
import type { StorageController } from "../src/storage/storage-controller";

/**
 * A resumable upload that could not be stored used to answer `204`.
 *
 * TUS says a `PATCH` answering `204` with `Upload-Offset` equal to the declared
 * length means the server has the file. `finalize` did three things that made
 * that a lie: it marked the upload complete before writing anything, it
 * returned quietly when no storage was configured, and it caught every failure
 * from `putObject` and logged it. A full bucket, expired credentials and a
 * deleted bucket all reached the client as a successful upload of a file that
 * does not exist — after however many minutes the transfer took.
 *
 * Marking it complete up front was the compounding part: a completed upload is
 * refused a retry and skipped by the stale sweeper, so the client could not try
 * again and the bytes sat in the temp directory forever.
 */
describe("a TUS upload that cannot be stored", () => {
    let scratch: string;

    beforeEach(() => {
        scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-tus-"));
    });
    afterEach(() => {
        fs.rmSync(scratch, { recursive: true, force: true });
    });

    /** A controller that records what it was given, or refuses. */
    const controller = (behaviour: "store" | "throw") => {
        const stored: Array<{ key: string }> = [];
        const ctrl = {
            putObject: async ({ key }: { key: string }) => {
                if (behaviour === "throw") throw new Error("bucket is full");
                stored.push({ key });
                return { key };
            }
        } as unknown as StorageController;
        return { ctrl, stored };
    };

    /**
     * Drive one whole upload through the routes, as a client would: create,
     * then a single PATCH carrying the entire body.
     */
    async function upload(handler: TusHandler, body = "hello") {
        const app = new Hono();
        // The storage router installs this, and it is what turns a thrown
        // ApiError into its status code — without it every refusal here would
        // read as a 500 and the test would be about Hono, not about the
        // handler.
        app.onError(errorHandler);
        app.post("/tus", (c) => handler.create(c));
        app.patch("/tus/:id", (c) => handler.patch(c, c.req.param("id")));

        const created = await app.request("/tus", {
            method: "POST",
            headers: {
                "Upload-Length": String(Buffer.byteLength(body)),
                "Upload-Metadata": `key ${Buffer.from("note.txt").toString("base64")}`
            }
        });
        const location = created.headers.get("Location")!;
        const id = location.split("/").pop()!;

        const patch = () => app.request(`/tus/${id}`, {
            method: "PATCH",
            headers: {
                "Upload-Offset": "0",
                "Content-Type": "application/offset+octet-stream"
            },
            body
        });

        return { id, patch, app };
    }

    const tempFiles = () => {
        const dir = path.join(scratch, ".tus-uploads");
        return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    };

    it("stores the bytes and answers 204 when storage takes them", async () => {
        const { ctrl, stored } = controller("store");
        const { patch } = await upload(new TusHandler(scratch, ctrl));

        const res = await patch();

        expect(res.status).toBe(204);
        expect(stored.map(s => s.key)).toEqual(["note.txt"]);
        expect(tempFiles()).toEqual([]);
    });

    it("refuses the PATCH when the store rejects it, rather than reporting success", async () => {
        const { ctrl } = controller("throw");
        const { patch } = await upload(new TusHandler(scratch, ctrl));

        const res = await patch();

        expect(res.status).toBe(502);
        expect(await res.json()).toMatchObject({
            error: { code: "STORAGE_WRITE_FAILED" }
        });
    });

    it("keeps the bytes on disk when the store rejects them, so a retry has something to send", async () => {
        const { ctrl } = controller("throw");
        const { patch } = await upload(new TusHandler(scratch, ctrl));

        await patch();

        expect(tempFiles()).toHaveLength(1);
    });

    it("refuses the PATCH when no storage is configured at all", async () => {
        const { patch } = await upload(new TusHandler(scratch, undefined));

        const res = await patch();

        expect(res.status).toBe(503);
        expect(await res.json()).toMatchObject({
            error: { code: "STORAGE_NOT_CONFIGURED" }
        });
    });

    it("leaves a failed upload retryable rather than 'already completed'", async () => {
        // The compounding defect: marking the upload complete before the store
        // succeeded meant the client's retry was answered "Upload already
        // completed" — the one thing it could do about the failure, refused.
        const failing = controller("throw");
        const handler = new TusHandler(scratch, failing.ctrl);
        const { id, patch, app } = await upload(handler);

        expect((await patch()).status).toBe(502);

        // A retry sends nothing new: the bytes are all there, so the empty
        // chunk lands at `offset === size` and finalization runs again.
        const retry = await app.request(`/tus/${id}`, {
            method: "PATCH",
            headers: {
                "Upload-Offset": "5",
                "Content-Type": "application/offset+octet-stream"
            },
            body: ""
        });

        // Still 502 — the store is still refusing — but *reachable*, which is
        // what "not completed" buys. It is not a 400 about a finished upload.
        expect(retry.status).toBe(502);
    });
});
