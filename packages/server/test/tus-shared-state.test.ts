import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
/**
 * A resumable upload is not held by the process that created it.
 *
 * The upload's state lived in that process's memory, so a `HEAD` or `PATCH`
 * that reached another instance — no sticky routing — answered 404, and a
 * restart or a rolling deploy sent every upload in progress back to byte 0.
 * Its bytes were already a file in the upload directory; now what `create`
 * decided about it (key, bucket, source, type, owner, size) is a record
 * beside them, and the offset is the bytes file's length. Every process that
 * shares the directory — one volume at `STORAGE_PATH` — serves every upload,
 * and a restarted one picks up where the last stopped.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { LocalStorageController } from "../src/storage/LocalStorageController";
import { createStorageRoutes } from "../src/storage/routes";
import { TusHandler } from "../src/storage/tus-handler";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";

const b64 = (s: string) => Buffer.from(s).toString("base64");

describe("a resumable upload shared by the processes that share its directory", () => {
    let root: string;
    let finalized: { key: string; user?: { uid: string } | null }[];

    /** One server process, over the shared storage root. */
    function instance(): Hono<HonoEnv> {
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({
            controller: new LocalStorageController({ type: "local", basePath: root }),
            requireAuth: true,
            triggers: [{ path: "**", events: ["finalize"], handler: async (event) => { finalized.push({ key: event.key, user: event.user }); } }]
        }));
        return app;
    }

    const auth = async (uid: string) => ({ Authorization: `Bearer ${await generateAccessToken(uid, [])}` });

    async function create(app: Hono<HonoEnv>, uid: string, key: string, length: number): Promise<string> {
        const res = await app.request("http://api.test/api/storage/tus", {
            method: "POST",
            headers: {
                ...(await auth(uid)),
                "Tus-Resumable": "1.0.0",
                "Upload-Length": String(length),
                "Upload-Metadata": `key ${b64(key)},filetype ${b64("text/plain")}`
            }
        });
        expect(res.status).toBe(201);
        return res.headers.get("Location")!.split("/").pop()!;
    }

    const patch = async (app: Hono<HonoEnv>, uid: string, id: string, offset: number, body: string) => app.request(`http://api.test/api/storage/tus/${id}`, {
        method: "PATCH",
        headers: {
            ...(await auth(uid)),
            "Tus-Resumable": "1.0.0",
            "Upload-Offset": String(offset),
            "Content-Type": "application/offset+octet-stream"
        },
        body
    });

    const head = async (app: Hono<HonoEnv>, uid: string, id: string) =>
        app.request(`http://api.test/api/storage/tus/${id}`, { method: "HEAD", headers: await auth(uid) });

    beforeEach(() => {
        configureJwt({ secret: "test-secret-key-for-jwt-testing-1234567890" });
        root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-tus-shared-"));
        finalized = [];
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("is resumed by another process: its offset, its next chunk, its finalize", async () => {
        const a = instance();
        const b = instance();

        const id = await create(a, "alice", "notes/hello.txt", 11);
        expect((await patch(b, "alice", id, 0, "hello ")).status).toBe(204);

        const progress = await head(a, "alice", id);
        expect(progress.status).toBe(200);
        expect(progress.headers.get("Upload-Offset")).toBe("6");

        const done = await patch(a, "alice", id, 6, "world");
        expect(done.status).toBe(204);
        expect(done.headers.get("Upload-Offset")).toBe("11");

        const stored = await new LocalStorageController({ type: "local", basePath: root }).getObject("notes/hello.txt");
        expect(await stored?.text()).toBe("hello world");
        expect(stored?.type).toBe("text/plain");
        // Fired once, for the user the upload was authorized for.
        expect(finalized).toEqual([{ key: "notes/hello.txt", user: expect.objectContaining({ uid: "alice" }) }]);
        // Nothing left behind, and every process now answers 404 for it.
        expect(fs.readdirSync(path.join(root, ".tus-uploads"))).toEqual([]);
        expect((await head(b, "alice", id)).status).toBe(404);
    });

    it("survives a restart: a new process resumes where the old one stopped", async () => {
        const before = instance();
        const id = await create(before, "alice", "notes/restart.txt", 8);
        expect((await patch(before, "alice", id, 0, "1234")).status).toBe(204);

        const after = instance();
        expect((await head(after, "alice", id)).headers.get("Upload-Offset")).toBe("4");
        expect((await patch(after, "alice", id, 4, "5678")).status).toBe(204);
        expect(await (await new LocalStorageController({ type: "local", basePath: root }).getObject("notes/restart.txt"))?.text()).toBe("12345678");
    });

    it("is still its owner's alone on every process", async () => {
        const a = instance();
        const b = instance();
        const id = await create(a, "alice", "notes/private.txt", 4);

        expect((await head(b, "mallory", id)).status).toBe(404);
        expect((await patch(b, "mallory", id, 0, "evil")).status).toBe(404);
        expect((await head(b, "alice", id)).headers.get("Upload-Offset")).toBe("0");
    });

    it("is gone everywhere once cancelled on one process", async () => {
        const a = instance();
        const b = instance();
        const id = await create(a, "alice", "notes/cancel.txt", 4);
        expect((await head(b, "alice", id)).status).toBe(200);

        const cancelled = await a.request(`http://api.test/api/storage/tus/${id}`, { method: "DELETE", headers: await auth("alice") });
        expect(cancelled.status).toBe(204);
        expect((await head(b, "alice", id)).status).toBe(404);
        expect((await patch(b, "alice", id, 0, "late")).status).toBe(404);
    });

    it("answers 404 for an id that is not one, without touching a path", async () => {
        const a = instance();
        fs.writeFileSync(path.join(root, "outside.json"), JSON.stringify({ id: "../outside" }));
        for (const id of ["..%2Foutside", "not-an-upload", "00000000-0000-0000-0000-000000000000"]) {
            expect((await head(a, "alice", id)).status).toBe(404);
        }
    });

    it("is collected after a day by a process that never saw it", async () => {
        const a = instance();
        const id = await create(a, "alice", "notes/abandoned.txt", 4);
        const dir = path.join(root, ".tus-uploads");
        const dayAndAMinuteAgo = new Date(Date.now() - (24 * 60 + 1) * 60 * 1000);
        for (const name of fs.readdirSync(dir)) fs.utimesSync(path.join(dir, name), dayAndAMinuteAgo, dayAndAMinuteAgo);
        // A fresh one, which stays.
        const fresh = await create(a, "alice", "notes/fresh.txt", 4);

        const sweeper = new TusHandler(root, new LocalStorageController({ type: "local", basePath: root }));
        await (sweeper as unknown as { cleanupStale(): Promise<void> }).cleanupStale();

        expect(fs.readdirSync(dir).sort()).toEqual([fresh, `${fresh}.json`].sort());
        expect((await head(a, "alice", id)).status).toBe(404);
    });
});
