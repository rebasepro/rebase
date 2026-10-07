/**
 * A backup downloads through a short-lived link, so the browser streams it to disk.
 *
 * The download route needs the admin's bearer header, and a browser cannot put
 * a header on a navigation. So `backups.download()` fetched the dump and held
 * it whole in the tab as a Blob: a 2 GB dump was 2 GB of the tab's memory, with
 * no progress, and in Node a 5 GB dump ran out of memory.
 *
 * `POST /download-url` (behind the admin gate) mints a token good for one
 * backup at one destination for 60 seconds, and `GET /download?key=…&token=…`
 * takes it in place of the header — for that backup only. The token has its own
 * purpose and audience, so it is never a session, a storage download or an MCP
 * token, and none of those is one.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { createBackupLinkRoutes, createBackupRoutes } from "../src/backup/backup-routes";
import { parseBackupDestination } from "../src/backup/backup-common";
import type { StorageController } from "../src/storage";
import {
    configureJwt,
    generateAccessToken,
    generateDownloadToken,
    signPurposeToken,
    verifyAccessToken,
    verifyDownloadToken
} from "../src/auth/jwt";

const DUMP = "rebase-app-20260714T030000Z.dump";
const OTHER = "rebase-app-20260715T030000Z.dump";
const ADMIN = { Authorization: "Bearer admin" };

/**
 * Stands in for every gate on `/admin/*` — the auth adapter's admin routers
 * and the Backups gate: a request without the admin's header goes no further.
 * `admin-surfaces-gate.test.ts` runs the same link through the real ones.
 */
function fakeGate(router: Hono<HonoEnv>): void {
    router.use("/*", async (c, next) => {
        if (c.req.header("Authorization") !== "Bearer admin") return c.json({ error: { code: "UNAUTHORIZED" } }, 401);
        await next();
    });
}

describe("backup download links", () => {
    let root: string;
    let dir: string;
    let destination: string;
    const content = "PGDMP".padEnd(100 * 1024 + 3, "x");

    beforeAll(() => {
        configureJwt({ secret: "backup-download-link-test-secret-0123456789abcdef", accessExpiresIn: "1h" });
        root = fs.mkdtempSync(path.join(os.tmpdir(), "backup-link-"));
        dir = path.join(root, "backups");
        fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, DUMP), content);
        fs.writeFileSync(path.join(dir, OTHER), "OTHER");
        fs.writeFileSync(path.join(root, "escape.dump"), "SECRET");
    });
    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
    beforeEach(() => {
        destination = dir;
    });
    afterEach(() => jest.restoreAllMocks());

    /** Mounted as `init.ts` mounts them: the link routes, then the gate, then the gated routes. */
    function app(storage?: StorageController) {
        const config = {
            getDestination: () => parseBackupDestination(destination),
            ...(storage ? { storageFor: () => storage } : {})
        };
        const router = new Hono<HonoEnv>();
        router.route("/", createBackupLinkRoutes(config));
        fakeGate(router);
        router.route("/", createBackupRoutes(config));
        return router;
    }

    async function mint(router: Hono<HonoEnv>, key: string, headers: Record<string, string> = ADMIN) {
        return router.request("/download-url", {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ key })
        });
    }

    async function linkFor(router: Hono<HonoEnv>, key: string): Promise<{ url: string; token: string; expiresIn: number }> {
        const res = await mint(router, key);
        expect(res.status).toBe(200);
        return await res.json() as { url: string; token: string; expiresIn: number };
    }

    const get = (router: Hono<HonoEnv>, key: string, token: string, headers: Record<string, string> = {}) =>
        router.request(`/download?key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`, { headers });

    it("mints a link only behind the admin gate", async () => {
        const res = await mint(app(), path.join(dir, DUMP), {});
        expect(res.status).toBe(401);
    });

    it("streams the backup through the link, with no Authorization header", async () => {
        const router = app();
        const readFileSync = jest.spyOn(fs, "readFileSync");
        const link = await linkFor(router, path.join(dir, DUMP));

        expect(link.expiresIn).toBe(60);
        expect(link.url).toBe(`/download?key=${encodeURIComponent(path.join(dir, DUMP))}&token=${encodeURIComponent(link.token)}`);

        const res = await router.request(link.url);
        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Disposition")).toBe(`attachment; filename="${DUMP}"`);
        expect(res.headers.get("Content-Length")).toBe(String(content.length));
        expect(res.headers.get("Cache-Control")).toBe("no-store");
        expect(await res.text()).toBe(content);
        expect(readFileSync).not.toHaveBeenCalled();
    });

    it("refuses a link for one backup spent on another", async () => {
        const router = app();
        const link = await linkFor(router, path.join(dir, DUMP));
        const res = await get(router, path.join(dir, OTHER), link.token);
        expect(res.status).toBe(401);
        expect(await res.text()).not.toContain("OTHER");
    });

    it("refuses a link once it has expired", async () => {
        const router = app();
        const link = await linkFor(router, path.join(dir, DUMP));
        const now = Date.now();
        jest.spyOn(Date, "now").mockReturnValue(now + 61_000);
        const res = await get(router, path.join(dir, DUMP), link.token);
        expect(res.status).toBe(401);
    });

    it("refuses a link minted for another destination", async () => {
        // Same key string, another BACKUP_DESTINATION between mint and use.
        const router = app();
        destination = "s3://bucket/nightly";
        const s3 = await linkFor(app({
            getObjectStream: async () => ({ stream: new Blob(["S3"]).stream(), size: 2, contentType: "application/octet-stream", lastModified: 0 })
        } as unknown as StorageController), `nightly/${DUMP}`);
        destination = "s3://other-bucket/nightly";
        const res = await get(router, `nightly/${DUMP}`, s3.token);
        expect(res.status).toBe(401);
    });

    it("refuses a token minted for anything else: a session, a storage download, another purpose", async () => {
        const router = app();
        const key = path.join(dir, DUMP);
        const tokens = [
            await generateAccessToken("admin-1", ["admin"]),
            await generateDownloadToken(key),
            await signPurposeToken("mfa-pending", { uid: "admin-1" }, 60),
            await signPurposeToken("backup-download", { scope: `backup:${dir}:${key}` }, 60),
            "not-a-token"
        ];
        for (const token of tokens) {
            const res = await get(router, key, token);
            expect([token.slice(0, 12), res.status]).toEqual([token.slice(0, 12), 401]);
        }
    });

    it("refuses a bad link even when the request also carries the admin's header", async () => {
        // A link is an answer on its own; a bad one never falls through to the header.
        const router = app();
        const link = await linkFor(router, path.join(dir, DUMP));
        const res = await get(router, path.join(dir, OTHER), link.token, ADMIN);
        expect(res.status).toBe(401);
    });

    it("is never accepted as a session or a storage download token", async () => {
        const link = await linkFor(app(), path.join(dir, DUMP));
        expect(await verifyAccessToken(link.token)).toBeNull();
        expect(await verifyDownloadToken(link.token)).toBeNull();
    });

    it("leaves the header path as it was", async () => {
        const router = app();
        expect((await router.request(`/download?key=${encodeURIComponent(path.join(dir, DUMP))}`)).status).toBe(401);
        const res = await router.request(`/download?key=${encodeURIComponent(path.join(dir, DUMP))}`, { headers: ADMIN });
        expect(res.status).toBe(200);
        expect(await res.text()).toBe(content);
    });

    it("mints nothing for a key the download route would refuse", async () => {
        const router = app();
        expect((await mint(router, path.join(dir, "..", "escape.dump"))).status).toBe(404);
        expect((await mint(router, path.join(dir, "missing.dump"))).status).toBe(404);
        expect((await mint(router, "")).status).toBe(400);

        destination = "s3://bucket/nightly";
        const storage = {
            statObject: async (key: string, bucket?: string) =>
                bucket === "bucket" && key === `nightly/${DUMP}` ? { size: 1, contentType: "application/octet-stream" } : null
        } as unknown as StorageController;
        const s3 = app(storage);
        expect((await mint(s3, `uploads/${DUMP}`)).status).toBe(404);
        expect((await mint(s3, "s3://other/nightly/x.dump")).status).toBe(404);
        expect((await mint(s3, `nightly/${OTHER}`)).status).toBe(404);
        expect((await mint(s3, `nightly/${DUMP}`)).status).toBe(200);
    });

    it("streams an object-storage backup through the link", async () => {
        destination = "s3://bucket/nightly";
        const getObject = jest.fn(async () => null);
        const storage = {
            getObject,
            getObjectStream: async (key: string, options?: { bucket?: string }) =>
                key === `nightly/${DUMP}` && options?.bucket === "bucket"
                    ? { stream: new Blob([content]).stream(), size: content.length, contentType: "application/octet-stream", lastModified: 0 }
                    : null
        } as unknown as StorageController;
        const router = app(storage);
        const link = await linkFor(router, `nightly/${DUMP}`);
        const res = await router.request(link.url);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe(content);
        expect(getObject).not.toHaveBeenCalled();
    });
});
