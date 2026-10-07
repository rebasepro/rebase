import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
/**
 * The SDK sends a file over 8 MiB through the resumable (TUS) endpoint, and
 * the object that lands is the one `POST /upload` would have stored.
 *
 * `POST /upload` is one multipart body that the server parses whole before
 * the route runs — three to five times the file in its memory (401–501 MB
 * for a 100 MB file). A TUS chunk is one request under the global body limit,
 * and finalize streams from disk, so the server holds one chunk at a time.
 * The resumable route already ran every check the multipart one runs; what
 * it lacked was the object's custom metadata and a way to tell the client
 * what it stored (`{ key, bucket, storageUrl }`). Both are here, and pinned
 * against the multipart route: same bytes, type, metadata, result, authorize
 * calls and trigger.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { LocalStorageController } from "../src/storage/LocalStorageController";
import { createStorageRoutes } from "../src/storage/routes";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import { resolveCorsOptions, type RebaseBootEnv } from "../src/boot/env";
import type { StorageAuthorizeContext } from "../src/storage/types";
import type { StorageTriggerEvent } from "../src/storage/triggers";
import { createTransport } from "../../client/src/transport";
import { createStorage } from "../../client/src/storage";

const MiB = 1024 * 1024;

/** `n` bytes that are not all the same, so a misplaced chunk shows. */
function bytesOf(n: number): Uint8Array {
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i += 4096) bytes[i] = (i / 4096) % 251;
    return bytes;
}

describe("a large upload from the SDK", () => {
    let root: string;
    let authorized: StorageAuthorizeContext[];
    let triggered: Record<string, unknown>[];
    let token: string;

    function server(base = root): Hono<HonoEnv> {
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({
            controller: new LocalStorageController({ type: "local", basePath: base, maxFileSize: 64 * MiB }),
            requireAuth: true,
            maxFileSize: 64 * MiB,
            authorize: async (ctx) => {
                authorized.push({ ...ctx, data: undefined });
                return true;
            },
            triggers: [{ path: "**", events: ["finalize"], handler: async (event) => { triggered.push({ ...event, at: undefined }); } }]
        }));
        return app;
    }

    /** The SDK over `apps` in turn (one per request, round-robin: a load balancer), and what each request was. */
    function sdk(apps: Hono<HonoEnv>[]) {
        const seen: string[] = [];
        let next = 0;
        const storage = createStorage(createTransport({
            baseUrl: "http://localhost",
            token,
            fetch: (input, init) => {
                const url = input instanceof Request ? input.url : String(input);
                seen.push(`${init?.method ?? "GET"} ${new URL(url).pathname.replace(/[0-9a-f-]{36}$/, ":id")}`);
                const app = apps[next++ % apps.length];
                return Promise.resolve(app.request(url, init));
            }
        }));
        return { storage, seen };
    }

    beforeEach(async () => {
        configureJwt({ secret: "test-secret-key-for-jwt-testing-1234567890" });
        root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-resumable-sdk-"));
        authorized = [];
        triggered = [];
        token = await generateAccessToken("alice", []);
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("goes up a chunk at a time, and lands as the multipart route lands it", async () => {
        const app = server();
        const { storage, seen } = sdk([app]);
        const body = bytesOf(20 * MiB);
        const props = {
            metadata: { caption: "Ünïcode, with a comma", rating: 5 },
            context: { collection: "media", property: "video" }
        };

        const viaSdk = await storage.putObject({ file: new File([body], "clip.mp4", { type: "video/mp4" }), key: "videos/a.mp4", ...props });

        // Three chunks of 8 MiB at most, and no multipart request.
        expect(seen).toEqual(["POST /api/storage/tus", "PATCH /api/storage/tus/:id", "PATCH /api/storage/tus/:id", "PATCH /api/storage/tus/:id"]);

        // The same file, the same way, through the multipart route.
        const form = new FormData();
        form.append("file", new File([body], "clip.mp4", { type: "video/mp4" }));
        form.append("key", "videos/b.mp4");
        form.append("collection", "media");
        form.append("property", "video");
        form.append("metadata_caption", "Ünïcode, with a comma");
        form.append("metadata_rating", "5");
        const multipart = await app.request("http://localhost/api/storage/upload", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
        expect(multipart.status).toBe(201);
        const viaForm = (await multipart.json() as { data: { key: string; bucket: string; storageUrl: string } }).data;

        expect(viaSdk).toEqual({ ...viaForm, key: "videos/a.mp4", storageUrl: viaForm.storageUrl.replace("videos/b.mp4", "videos/a.mp4") });

        const controller = new LocalStorageController({ type: "local", basePath: root });
        const [a, b] = await Promise.all([controller.getObject("videos/a.mp4"), controller.getObject("videos/b.mp4")]);
        expect(Buffer.compare(Buffer.from(await a!.arrayBuffer()), Buffer.from(body))).toBe(0);
        expect(a!.type).toBe(b!.type);
        const sidecar = (key: string) => {
            const { uploadedAt: _when, ...rest } = JSON.parse(fs.readFileSync(path.join(root, "default", `${key}.metadata.json`), "utf-8"));
            return rest;
        };
        expect(sidecar("videos/a.mp4")).toEqual(sidecar("videos/b.mp4"));
        expect(sidecar("videos/a.mp4")).toMatchObject({ caption: "Ünïcode, with a comma", rating: "5" });

        // The same question to the authorize hook, and the same trigger.
        const asked = (key: string) => authorized.filter(ctx => ctx.key === key).map(({ key: _key, ...ctx }) => ctx);
        expect(asked("videos/a.mp4")).toEqual(asked("videos/b.mp4"));
        expect(asked("videos/a.mp4")).toHaveLength(1);
        const fired = (key: string) => triggered.filter(event => event.key === key).map(({ key: _key, ...event }) => event);
        expect(fired("videos/a.mp4")).toEqual(fired("videos/b.mp4"));
        expect(fired("videos/a.mp4")).toEqual([expect.objectContaining({ size: 20 * MiB, contentType: "video/mp4" })]);
    });

    it("keeps a small file on the multipart route", async () => {
        const { storage, seen } = sdk([server()]);
        await storage.putObject({ file: new File([bytesOf(MiB)], "small.bin"), key: "small.bin" });
        expect(seen).toEqual(["POST /api/storage/upload"]);
    });

    it("is refused as the multipart route refuses it", async () => {
        const { storage, seen } = sdk([server()]);
        await expect(storage.putObject({ file: new File([bytesOf(65 * MiB)], "huge.bin"), key: "huge.bin" }))
            .rejects.toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });
        expect(seen).toEqual(["POST /api/storage/tus"]);
    });

    it("falls back to the multipart route when another instance answers a chunk, and stays there", async () => {
        // Two instances, each with its own disk, no sticky sessions.
        const other = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-resumable-sdk-other-"));
        try {
            const { storage, seen } = sdk([server(), server(other)]);
            const first = await storage.putObject({ file: new File([bytesOf(10 * MiB)], "one.bin"), key: "one.bin" });
            expect(first.key).toBe("one.bin");
            expect(seen).toEqual(["POST /api/storage/tus", "PATCH /api/storage/tus/:id", "POST /api/storage/upload"]);

            seen.length = 0;
            await storage.putObject({ file: new File([bytesOf(10 * MiB)], "two.bin"), key: "two.bin" });
            expect(seen).toEqual(["POST /api/storage/upload"]);
        } finally {
            fs.rmSync(other, { recursive: true, force: true });
        }
    });

    it("can be read by a browser on another origin: the headers it answers in are exposed", async () => {
        const app = new Hono();
        app.use("/*", cors(resolveCorsOptions({ NODE_ENV: "development" } as RebaseBootEnv)));
        app.post("/api/storage/tus", (c) => c.body(null, 201));
        const res = await app.request("/api/storage/tus", { method: "POST", headers: { Origin: "http://localhost:5173" } });
        const exposed = (res.headers.get("access-control-expose-headers") ?? "").split(",").map(name => name.trim().toLowerCase());
        expect(exposed).toEqual(expect.arrayContaining(["location", "upload-offset", "rebase-upload-result"]));
    });
});

// Keeps the trigger event type in view: the comparison above is of its fields.
export type { StorageTriggerEvent };
