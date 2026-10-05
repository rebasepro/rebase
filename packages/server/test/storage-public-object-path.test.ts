import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
/**
 * Whether a storage read is public is decided on the key the route serves.
 *
 * `publicObjectAuth` — the middleware that lets an anonymous caller through to
 * an object under `public/` — used to read the raw URL path, through
 * `isPublicStoragePath`, which strips everything up to the first `://`. The
 * route then served `canonicalStorageKey` of that path, which folds `//` to
 * `/`. So `GET /file/notes://public/secret.txt` was judged as `public/secret.txt`
 * and served `notes:/public/secret.txt`, a private key, to anyone — and the
 * authorize hook, which is not asked about the synthetic `public` principal,
 * never saw the request. `/metadata` was the same door.
 *
 * Each example below is a spelling of the private key that reached it, or a
 * spelling of a public key that must keep working. The property over every
 * spelling is `property/storage-public-decision.property.test.ts`.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Hono } from "hono";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { LocalStorageController } from "../src/storage/LocalStorageController";
import { createStorageRoutes } from "../src/storage/routes";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import type { StorageAuthorizeContext } from "../src/storage/types";

describe("a public read is decided on the key the route serves", () => {
    let app: Hono<HonoEnv>;
    let tempDir: string;
    let controller: LocalStorageController;
    let asked: StorageAuthorizeContext[];

    /** A hook that refuses every read: nothing private may be served anonymously. */
    const deniesEveryRead = async (ctx: StorageAuthorizeContext) => {
        asked.push(ctx);
        return ctx.operation !== "read";
    };

    function mount(authorize: (ctx: StorageAuthorizeContext) => Promise<boolean>) {
        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        // `requireAuth` left at its default (true): the deployment this matters on.
        app.route("/api/storage", createStorageRoutes({ controller, authorize }));
    }

    const store = (key: string, body: string) => controller.putObject({
        file: new File([Buffer.from(body)], path.posix.basename(key), { type: "text/plain" }),
        key
    });

    const get = (p: string, headers: Record<string, string> = {}) =>
        app.fetch(new Request(`http://localhost/api/storage/${p}`, { headers }));

    beforeEach(async () => {
        configureJwt({ secret: "test-secret-key-for-jwt-testing-1234567890" });
        asked = [];
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-storage-public-path-"));
        controller = new LocalStorageController({ type: "local", basePath: tempDir });
        await store("notes:/public/secret.txt", "TOP SECRET");
        await store("public/logo.txt", "open to all");
        mount(deniesEveryRead);
    });

    afterEach(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    describe("a private key whose text contains `:/public/`", () => {
        it("is refused anonymously however the path spells it", async () => {
            for (const spelling of [
                "notes:/public/secret.txt",
                // The one that was served: `://` is a scheme to the old check
                // and a doubled slash to the canonicalizer.
                "notes://public/secret.txt",
                "notes:%2F%2Fpublic/secret.txt",
                "notes%3A%2F%2Fpublic%2Fsecret.txt",
                "default/notes://public/secret.txt",
                "notes:///public/secret.txt"
            ]) {
                const res = await get(`file/${spelling}`);
                expect({ spelling, status: res.status }).toEqual({ spelling, status: 401 });
                expect(await res.text()).not.toContain("TOP SECRET");
            }
        });

        it("mints no download token for it", async () => {
            for (const spelling of ["notes:/public/secret.txt", "notes://public/secret.txt"]) {
                const res = await get(`metadata/${spelling}`);
                expect({ spelling, status: res.status }).toEqual({ spelling, status: 401 });
                const body = await res.json() as { data?: { token?: string } };
                expect(body.data?.token).toBeUndefined();
            }
        });
    });

    describe("a public key", () => {
        it("is still served anonymously, past a hook that denies every read", async () => {
            for (const spelling of [
                "public/logo.txt",
                "default/public/logo.txt",
                // Spellings the route always served as `public/logo.txt` and the
                // raw-path check refused: the decision now follows the key.
                "DEFAULT/public/logo.txt",
                "public//logo.txt",
                ".%2Fpublic/logo.txt",
                "default//public/logo.txt"
            ]) {
                const res = await get(`file/${spelling}`);
                expect({ spelling, status: res.status }).toEqual({ spelling, status: 200 });
                expect(await res.text()).toBe("open to all");
            }
            expect(asked).toEqual([]);
        });

        it("is described as public by /metadata, with no token", async () => {
            const res = await get("metadata/public/logo.txt");
            expect(res.status).toBe(200);
            const { data } = await res.json() as { data: { public?: boolean; token?: string } };
            expect(data.public).toBe(true);
            expect(data.token).toBeUndefined();
        });
    });

    /**
     * The route reads a leading `default/` as the bucket, so the key
     * `default/public/x` is reached as `/file/default/default/public/x`. It is a
     * private key — `default/` is a folder in it, not a bucket — and
     * `isPublicStoragePath`, which tolerates a leading `default/` because it
     * reads paths, called it public when handed the key.
     */
    describe("a private key under a folder named `default`", () => {
        beforeEach(async () => {
            await store("default/public/secret.txt", "STILL SECRET");
        });

        it("is refused anonymously", async () => {
            const res = await get("file/default/default/public/secret.txt");
            expect(res.status).toBe(401);
        });

        it("is not offered to shared caches when read with a token", async () => {
            mount(async () => true);
            const admin = await generateAccessToken("ops-1", ["admin"]);
            const meta = await get("metadata/default/default/public/secret.txt", { Authorization: `Bearer ${admin}` });
            expect(meta.status).toBe(200);
            const { data } = await meta.json() as { data: { public?: boolean; token?: string } };
            expect(data.public).toBeUndefined();
            expect(data.token).toBeDefined();

            const res = await get(`file/default/default/public/secret.txt?token=${data.token}`);
            expect(res.status).toBe(200);
            expect(await res.text()).toBe("STILL SECRET");
            const cacheControl = res.headers.get("Cache-Control") ?? "";
            expect(cacheControl).toContain("private");
            expect(cacheControl).not.toContain("public");
        });
    });

    /**
     * Not the bug, but the same derivation: a `%` that does not start an escape
     * cannot name a key, and the route answered 500 for it.
     */
    it("answers 400 for a path that is not valid percent-encoding", async () => {
        const admin = await generateAccessToken("ops-1", ["admin"]);
        const res = await get("metadata/100%-done.txt", { Authorization: `Bearer ${admin}` });
        expect(res.status).toBe(400);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("INVALID_STORAGE_KEY");
    });
});
