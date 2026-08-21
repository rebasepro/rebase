import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
/**
 * Caching and revalidation for served objects.
 *
 * Two bugs and one absence motivated this:
 *
 *  - the local path sent no cache headers at all, so every load of every image
 *    re-read the file and re-sent the body;
 *  - the remote and transform paths sent `immutable`, which promises the body
 *    at this URL will never change. `putObject` on an existing key is ordinary,
 *    so an upload that replaced a file stayed invisible for an hour, or a year;
 *  - every response said `public`, including for objects that required
 *    credentials — explicit permission for a CDN or corporate proxy to store one
 *    user's private object and hand it to the next caller.
 *
 * The `public`/`private` split is the one worth being loudest about: it is the
 * difference between a cache that helps and a cache that leaks.
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
    buildEntityTag,
    objectValidators,
    cacheControl,
    isNotModified
} from "../src/storage/cache-headers";

describe("cacheControl", () => {
    it("marks a public object cacheable by shared caches", () => {
        expect(cacheControl({ isPublic: true, maxAgeSeconds: 60, staleWhileRevalidateSeconds: 86400 }))
            .toBe("public, max-age=60, stale-while-revalidate=86400, must-revalidate");
    });

    it("keeps a private object out of shared caches, and offers no stale window", () => {
        expect(cacheControl({ isPublic: false, maxAgeSeconds: 60, staleWhileRevalidateSeconds: 86400 }))
            .toBe("private, max-age=60, must-revalidate");
    });

    it("never says immutable — a storage key can be overwritten", () => {
        expect(cacheControl({ isPublic: true, maxAgeSeconds: 31536000 })).not.toContain("immutable");
    });
});

describe("validators", () => {
    it("changes when the size changes", () => {
        expect(buildEntityTag(10, 1000)).not.toBe(buildEntityTag(11, 1000));
    });

    it("changes when the modification time changes", () => {
        expect(buildEntityTag(10, 1000)).not.toBe(buildEntityTag(10, 2000));
    });

    it("is weak, because it is not a digest of the body", () => {
        expect(buildEntityTag(10, 1000).startsWith('W/"')).toBe(true);
    });

    it("floors Last-Modified to whole seconds so If-Modified-Since can match", () => {
        const v = objectValidators(10, 1_700_000_000_678);
        expect(v.lastModifiedMs).toBe(1_700_000_000_000);
        expect(v.lastModified).toBe(new Date(1_700_000_000_000).toUTCString());
    });
});

describe("isNotModified", () => {
    const validators = objectValidators(120, 1_700_000_000_000);
    const req = (headers: Record<string, string>) =>
        ({ req: { header: (name: string) => headers[name.toLowerCase()] } }) as never;

    it("matches its own ETag", () => {
        expect(isNotModified(req({ "if-none-match": validators.etag }), validators)).toBe(true);
    });

    it("compares weakly, so a stripped W/ prefix still matches", () => {
        expect(isNotModified(req({ "if-none-match": validators.etag.slice(2) }), validators)).toBe(true);
    });

    it("matches one tag out of a list", () => {
        expect(isNotModified(req({ "if-none-match": `W/"other", ${validators.etag}` }), validators)).toBe(true);
    });

    it("honours a wildcard", () => {
        expect(isNotModified(req({ "if-none-match": "*" }), validators)).toBe(true);
    });

    it("does not match a different entity", () => {
        expect(isNotModified(req({ "if-none-match": 'W/"deadbeef-1"' }), validators)).toBe(false);
    });

    it("prefers If-None-Match over If-Modified-Since when both are present", () => {
        // The date says "you already have it"; the tag says otherwise. The tag
        // is exact, so it wins and the body is sent.
        const headers = {
            "if-none-match": 'W/"stale"',
            "if-modified-since": new Date(1_800_000_000_000).toUTCString()
        };
        expect(isNotModified(req(headers), validators)).toBe(false);
    });

    it("falls back to If-Modified-Since", () => {
        expect(isNotModified(req({ "if-modified-since": validators.lastModified }), validators)).toBe(true);
    });

    it("sends the body when the object is newer than the client's copy", () => {
        const older = new Date(1_600_000_000_000).toUTCString();
        expect(isNotModified(req({ "if-modified-since": older }), validators)).toBe(false);
    });

    it("ignores an unparseable If-Modified-Since rather than treating it as a match", () => {
        expect(isNotModified(req({ "if-modified-since": "not a date" }), validators)).toBe(false);
    });

    it("sends the body when the request carries no validators at all", () => {
        expect(isNotModified(req({}), validators)).toBe(false);
    });
});

describe("GET /file/* — headers on the wire", () => {
    let app: Hono<HonoEnv>;
    let tempDir: string;
    let controller: LocalStorageController;

    const store = async (key: string, body: string, type: string) => {
        await controller.putObject({ file: new File([Buffer.from(body)], path.basename(key), { type }), key });
    };
    const get = (key: string, headers: Record<string, string> = {}) =>
        app.fetch(new Request(`http://localhost/api/storage/file/${key}`, { headers }));

    beforeEach(async () => {
        configureJwt({ secret: "test-secret-key-for-jwt-testing-1234567890" });
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-cache-headers-"));
        controller = new LocalStorageController({ basePath: tempDir });
        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({ controller, requireAuth: false }));
    });

    afterEach(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    it("sends an ETag and Last-Modified for a local object", async () => {
        await store("photos/a.png", "pretend png bytes", "image/png");
        const res = await get("photos/a.png");

        expect(res.status).toBe(200);
        expect(res.headers.get("ETag")).toMatch(/^W\/"[0-9a-f]+-[0-9a-f]+"$/);
        expect(res.headers.get("Last-Modified")).toBeTruthy();
        expect(res.headers.get("Vary")).toBe("Authorization");
    });

    it("answers 304 with no body when the client already has it", async () => {
        await store("photos/a.png", "pretend png bytes", "image/png");
        const etag = (await get("photos/a.png")).headers.get("ETag")!;

        const res = await get("photos/a.png", { "If-None-Match": etag });

        expect(res.status).toBe(304);
        expect(await res.text()).toBe("");
        // Repeated on the 304, or the next load revalidates immediately again.
        expect(res.headers.get("ETag")).toBe(etag);
        expect(res.headers.get("Cache-Control")).toBeTruthy();
    });

    it("sends the new body after the object is overwritten", async () => {
        await store("photos/a.png", "first", "image/png");
        const first = (await get("photos/a.png")).headers.get("ETag")!;

        // A different length, so the validator moves even if the filesystem
        // timestamp resolution would not.
        await store("photos/a.png", "second and longer", "image/png");

        const res = await get("photos/a.png", { "If-None-Match": first });
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("second and longer");
        expect(res.headers.get("ETag")).not.toBe(first);
    });

    it("marks an object under the public prefix as shared-cacheable", async () => {
        await store("public/logo.png", "bytes", "image/png");
        const res = await get("public/logo.png");

        expect(res.headers.get("Cache-Control")).toContain("public");
        expect(res.headers.get("Cache-Control")).toContain("stale-while-revalidate");
    });

    it("keeps a private object out of shared caches", async () => {
        await store("invoices/q3.pdf", "bytes", "application/pdf");
        const res = await get("invoices/q3.pdf");

        const cacheControlHeader = res.headers.get("Cache-Control")!;
        expect(cacheControlHeader).toContain("private");
        expect(cacheControlHeader).not.toContain("public");
        expect(cacheControlHeader).not.toContain("stale-while-revalidate");
    });

    it("does not claim immutable anywhere", async () => {
        await store("public/logo.png", "bytes", "image/png");
        await store("invoices/q3.pdf", "bytes", "application/pdf");

        for (const key of ["public/logo.png", "invoices/q3.pdf"]) {
            expect((await get(key)).headers.get("Cache-Control")).not.toContain("immutable");
        }
    });

    it("still refuses a missing file rather than answering 304 for it", async () => {
        const res = await get("photos/missing.png", { "If-None-Match": 'W/"1-1"' });
        expect(res.status).toBe(404);
    });

    it("leaves the content-type rules alone", async () => {
        await store("public/x.html", "<h1>hi</h1>", "text/html");
        const res = await get("public/x.html");

        expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
        expect(res.headers.get("Content-Disposition")).toBe("attachment");
        expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    });
});

describe("transform cache — a replaced source is not served from the old rendition", () => {
    let app: Hono<HonoEnv>;
    let tempDir: string;
    let controller: LocalStorageController;
    let key: string;

    /** A real PNG of a given size, so sharp does real work. */
    const png = async (width: number, height: number, colour: number) => {
        const sharp = (await import("sharp")).default;
        return sharp({
            create: { width, height, channels: 3, background: { r: colour, g: colour, b: colour } }
        }).png().toBuffer();
    };

    const put = async (bytes: Buffer) => {
        await controller.putObject({
            file: new File([new Uint8Array(bytes)], "a.png", { type: "image/png" }),
            key
        });
    };

    beforeEach(async () => {
        configureJwt({ secret: "test-secret-key-for-jwt-testing-1234567890" });
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-transform-stale-"));
        controller = new LocalStorageController({ basePath: tempDir });
        // Unique per run: the transform cache is module-scoped and outlives a test.
        key = `photos/${path.basename(tempDir)}.png`;
        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({ controller, requireAuth: false }));
    });

    afterEach(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    it("serves the new image after the source is overwritten", async () => {
        const url = `http://localhost/api/storage/file/${key}?width=32`;

        await put(await png(64, 64, 10));
        const first = Buffer.from(await (await app.fetch(new Request(url))).arrayBuffer());

        // A visibly different source: same dimensions would still re-encode to a
        // different body, but a different colour makes the difference obvious.
        await put(await png(64, 64, 250));
        const second = Buffer.from(await (await app.fetch(new Request(url))).arrayBuffer());

        // Before the key carried the source's validator, the second read hit the
        // module-scoped cache and returned the first rendition for a full hour.
        expect(second.equals(first)).toBe(false);
    });

    it("still serves a cached rendition when the source has not changed", async () => {
        const url = `http://localhost/api/storage/file/${key}?width=32`;
        await put(await png(64, 64, 10));

        const a = Buffer.from(await (await app.fetch(new Request(url))).arrayBuffer());
        const b = Buffer.from(await (await app.fetch(new Request(url))).arrayBuffer());

        expect(b.equals(a)).toBe(true);
    });
});
