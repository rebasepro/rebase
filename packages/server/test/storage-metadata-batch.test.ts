import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
/**
 * `POST /api/storage/metadata` — `GET /metadata/*` for many keys at once.
 *
 * A page of private thumbnails asked for each file's metadata (and its
 * download token) in a request of its own, every one against the caller's
 * rate-limit allowance. The batch answers up to 100 keys of one source in
 * one request, and each key is judged exactly as the single route judges it:
 * the same authorize hook, the same public rule, a download token of its own.
 * A key that is refused, missing or malformed answers its own error, and
 * neither fails nor reveals the others. The limiter charges ⌈N/10⌉.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Hono } from "hono";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { LocalStorageController } from "../src/storage/LocalStorageController";
import { createStorageRoutes, storageRateLimitCost } from "../src/storage/routes";
import { configureJwt, generateAccessToken, verifyDownloadToken } from "../src/auth/jwt";
import { createDataRateLimiter } from "../src/auth/rate-limiter";
import { MemoryRateLimitStore } from "../src/auth/rate-limit-store";
import type { StorageAuthorizeContext } from "../src/storage/types";
import { createTransport } from "../../client/src/transport";
import { createStorage } from "../../client/src/storage";

const BASE = "http://localhost/api/storage";

describe("POST /api/storage/metadata", () => {
    let tempDir: string;
    let controller: LocalStorageController;
    let calls: StorageAuthorizeContext[];
    let token: string;

    /** Only the owner named in the key's first segment may read it. */
    const ownerOnly = async (ctx: StorageAuthorizeContext) => {
        calls.push(ctx);
        return ctx.key.split("/")[0] === "alice" || ctx.key.startsWith("public/");
    };

    function mount(options: { requireAuth?: boolean; limit?: number } = {}): Hono<HonoEnv> {
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        const storage = new Hono<HonoEnv>();
        if (options.limit !== undefined) {
            storage.use("/*", createDataRateLimiter(
                { user: options.limit, anonymous: options.limit, store: new MemoryRateLimitStore() },
                { cost: storageRateLimitCost }
            ));
        }
        storage.route("/", createStorageRoutes({
            controller,
            requireAuth: options.requireAuth ?? true,
            authorize: ownerOnly
        }));
        app.route("/api/storage", storage);
        return app;
    }

    const batch = (app: Hono<HonoEnv>, body: unknown, bearer: string | null = token) => app.fetch(new Request(`${BASE}/metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
        body: JSON.stringify(body)
    }));

    const single = (app: Hono<HonoEnv>, key: string, bearer: string | null = token) =>
        app.fetch(new Request(`${BASE}/metadata/${key}`, { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} }));

    beforeEach(async () => {
        configureJwt({ secret: "test-secret-key-for-jwt-testing-1234567890" });
        calls = [];
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-storage-batch-"));
        controller = new LocalStorageController({ type: "local", basePath: tempDir });
        for (const key of ["alice/a.txt", "alice/b.png", "bob/secret.txt", "public/logo.png"]) {
            await controller.putObject({
                file: new File([Buffer.from(`bytes of ${key}`)], key.split("/").pop()!, { type: key.endsWith(".png") ? "image/png" : "text/plain" }),
                key
            });
        }
        token = await generateAccessToken("alice-uid", []);
    });

    afterEach(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    it("answers each key as GET /metadata/<key> does, in one request", async () => {
        const app = mount();
        const res = await batch(app, { keys: ["alice/a.txt", "alice/b.png", "public/logo.png"] });
        expect(res.status).toBe(200);
        const { data } = await res.json() as { data: Record<string, Record<string, unknown>> };

        for (const key of ["alice/a.txt", "alice/b.png", "public/logo.png"]) {
            const one = await (await single(app, key)).json() as { data: Record<string, unknown> };
            const { token: batchToken, ...batchRest } = data[key];
            const { token: singleToken, ...singleRest } = one.data;
            expect([key, batchRest]).toEqual([key, singleRest]);
            expect(typeof batchToken).toBe(typeof singleToken);
        }

        // A private key's token is its own: scoped to that path, and it reads the file.
        const grant = await verifyDownloadToken(String(data["alice/b.png"].token));
        expect(grant?.path).toBe("default/alice/b.png");
        const file = await app.fetch(new Request(`${BASE}/file/alice/b.png?token=${String(data["alice/b.png"].token)}`));
        expect(file.status).toBe(200);
        expect(await file.text()).toBe("bytes of alice/b.png");
        expect(data["public/logo.png"]).toEqual(expect.objectContaining({ public: true }));
        expect(data["public/logo.png"].token).toBeUndefined();
    });

    it("answers a refused, a missing and a malformed key with their own errors, and the rest in full", async () => {
        const app = mount();
        const res = await batch(app, { keys: ["alice/a.txt", "bob/secret.txt", "bob/nothing.txt", "alice/missing.txt", "_rebase/renditions/x.webp"] });
        expect(res.status).toBe(200);
        const { data } = await res.json() as { data: Record<string, { error?: { code: string; status: number }; size?: number }> };

        expect(data["alice/a.txt"].size).toBe("bytes of alice/a.txt".length);
        // Refused before the object is looked at: a refused key that exists and
        // one that does not are the same answer.
        expect(data["bob/secret.txt"].error).toEqual(expect.objectContaining({ code: "FORBIDDEN", status: 403 }));
        expect(data["bob/nothing.txt"].error).toEqual(data["bob/secret.txt"].error);
        expect(data["alice/missing.txt"].error).toEqual(expect.objectContaining({ code: "NOT_FOUND", status: 404 }));
        expect(data["_rebase/renditions/x.webp"].error?.status).toBe(400);
        // The hook was asked about each addressable key, once.
        expect(calls.map(call => call.key).sort()).toEqual(["alice/a.txt", "alice/missing.txt", "bob/nothing.txt", "bob/secret.txt"]);
    });

    it("refuses a body that is not 1–100 keys, whole", async () => {
        const app = mount();
        expect((await batch(app, { keys: [] })).status).toBe(400);
        expect((await batch(app, { keys: "alice/a.txt" })).status).toBe(400);
        expect((await batch(app, { keys: Array.from({ length: 101 }, (_, i) => `alice/${i}.txt`) })).status).toBe(400);
        expect((await batch(app, { keys: Array.from({ length: 100 }, (_, i) => `alice/${i}.txt`) })).status).toBe(200);
    });

    it("answers an anonymous caller the 401 the single route would, unless every key is public", async () => {
        const app = mount();
        const refused = await batch(app, { keys: ["alice/a.txt", "public/logo.png"] }, null);
        expect(refused.status).toBe(401);
        expect((await single(app, "alice/a.txt", null)).status).toBe(401);

        const open = await batch(app, { keys: ["public/logo.png"] }, null);
        expect(open.status).toBe(200);
        const { data } = await open.json() as { data: Record<string, { public?: boolean }> };
        expect(data["public/logo.png"].public).toBe(true);
    });

    it("answers an expired session with a 401, so the client refreshes and asks again", async () => {
        const app = mount();
        const res = await batch(app, { keys: ["alice/a.txt"] }, "not-a-valid-token");
        expect(res.status).toBe(401);
    });

    it("serves the SDK a page of previews in one request, each URL reading its own file", async () => {
        const app = mount();
        const seen: string[] = [];
        const storage = createStorage(createTransport({
            baseUrl: "http://localhost",
            token,
            fetch: (input, init) => {
                const url = input instanceof Request ? input.url : String(input);
                seen.push(`${init?.method ?? "GET"} ${new URL(url).pathname}`);
                return Promise.resolve(app.request(url, init));
            }
        }));

        const keys = ["alice/a.txt", "alice/b.png", "bob/secret.txt", "alice/missing.txt"];
        const results = await Promise.allSettled(keys.map(key => storage.getSignedUrl(key)));

        expect(seen).toEqual(["POST /api/storage/metadata"]);
        const [a, b, refused, missing] = results;
        expect(refused).toEqual({ status: "rejected", reason: expect.objectContaining({ status: 403 }) });
        expect(missing).toEqual({ status: "fulfilled", value: { url: null, fileNotFound: true } });
        for (const [result, body] of [[a, "bytes of alice/a.txt"], [b, "bytes of alice/b.png"]] as const) {
            if (result.status !== "fulfilled" || !result.value.url) throw new Error("expected a URL");
            const file = await app.request(result.value.url);
            expect(await file.text()).toBe(body);
        }
    });

    it("charges ⌈N/10⌉ requests against the caller's allowance", async () => {
        // An allowance of 25: two batches of 100 keys (10 each) fit, a third does not.
        const app = mount({ limit: 25 });
        const keys = Array.from({ length: 100 }, (_, i) => `alice/${i}.txt`);
        expect((await batch(app, { keys })).status).toBe(200);
        expect((await batch(app, { keys })).status).toBe(200);
        expect((await batch(app, { keys })).status).toBe(429);

        // A batch of 7 costs one, as a single request does.
        const small = mount({ limit: 3 });
        for (let i = 0; i < 3; i++) expect((await batch(small, { keys: keys.slice(0, 7) })).status).toBe(200);
        expect((await batch(small, { keys: keys.slice(0, 7) })).status).toBe(429);
    });

    it("costs the same as the requests it replaces — never less than one per ten keys", async () => {
        const cost = (body: unknown, method = "POST", requestPath = "/api/storage/metadata") =>
            storageRateLimitCost({ req: { method, path: requestPath, json: async () => body } });
        expect(await cost({ keys: ["a"] })).toBe(1);
        expect(await cost({ keys: Array.from({ length: 10 }, (_, i) => String(i)) })).toBe(1);
        expect(await cost({ keys: Array.from({ length: 11 }, (_, i) => String(i)) })).toBe(2);
        expect(await cost({ keys: Array.from({ length: 100 }, (_, i) => String(i)) })).toBe(10);
        // Duplicates are one key; past the cap, the refusal costs the cap.
        expect(await cost({ keys: Array.from({ length: 50 }, () => "same") })).toBe(1);
        expect(await cost({ keys: Array.from({ length: 500 }, (_, i) => String(i)) })).toBe(10);
        expect(await cost(undefined, "GET", "/api/storage/metadata/a.txt")).toBe(1);
    });
});
