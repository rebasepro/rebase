import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
/**
 * A key under a folder named `default`, through the SDK and the routes it
 * talks to.
 *
 * The routes read one leading `default/` of a request path as the bucket, so
 * the key `default/photo.png` is reached as `/file/default/default/photo.png`
 * (see `storage-public-object-path.test.ts`). The SDK sent a bare key as it
 * was, so `default/photo.png` arrived as `/file/default/photo.png` and named
 * the ROOT `photo.png`: Studio previewed the root file under the nested one's
 * name, and its Delete deleted the root file, said the nested one was deleted,
 * and left it where it was.
 *
 * Both halves are real here — `createRebaseClient` handed a `fetch` that is
 * the storage router over a local controller — because each passed on its
 * own: the client sent what its author believed the route wanted, and the
 * route did what its author believed clients send.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Hono } from "hono";
import { createRebaseClient } from "@rebasepro/client";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { LocalStorageController } from "../src/storage/LocalStorageController";
import { createStorageRoutes } from "../src/storage/routes";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";

describe("a key under a folder named `default`, through the SDK", () => {
    let tempDir: string;
    let controller: LocalStorageController;
    let client: ReturnType<typeof createRebaseClient>;

    const store = (key: string, body: string) => controller.putObject({
        file: new File([Buffer.from(body)], path.posix.basename(key), { type: "text/plain" }),
        key
    });

    /** Whether the default bucket holds `key` on disk. */
    const exists = (key: string) => fs.existsSync(path.join(tempDir, "default", key));

    const read = async (keyOrUrl: string) => {
        const file = await client.storage.getObject(keyOrUrl);
        return file === null ? null : await file.text();
    };

    beforeEach(async () => {
        configureJwt({ secret: "test-secret-key-for-jwt-testing-1234567890" });
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-storage-default-folder-"));
        controller = new LocalStorageController({ type: "local", basePath: tempDir });

        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({ controller }));

        client = createRebaseClient({
            baseUrl: "http://rebase.test",
            realtime: false,
            token: await generateAccessToken("ops-1", ["admin"]),
            fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
                app.fetch(new Request(String(input), init))) as typeof fetch
        });

        await store("photo.png", "ROOT");
        await store("default/photo.png", "NESTED");
    });

    afterEach(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    it("reads the nested file, not the root file of the same name", async () => {
        expect(await read("default/photo.png")).toBe("NESTED");
    });

    it("describes the nested file with its own metadata", async () => {
        const config = await client.storage.getSignedUrl("default/photo.png");
        expect(config.fileNotFound).toBeFalsy();
        expect(config.metadata?.size).toBe("NESTED".length);
    });

    it("deletes the nested file and leaves the root file alone", async () => {
        await client.storage.deleteObject("default/photo.png");

        expect(exists("default/photo.png")).toBe(false);
        expect(exists("photo.png")).toBe(true);
    });

    it("addresses every key a listing of the folder hands back as the object listed", async () => {
        const listing = await client.storage.listObjects("default");
        expect(listing.items.map((item) => item.fullPath)).toEqual(["default/photo.png"]);

        expect(await read(listing.items[0].fullPath)).toBe("NESTED");
    });

    it("reads a private file under `default/public/`, not the root public file", async () => {
        // `isPublicStoragePath` tolerates a leading `default/` bucket segment,
        // so this key was taken for public: no token, and the URL served the
        // root `public/report.txt` in its place.
        await store("default/public/report.txt", "PRIVATE");
        await store("public/report.txt", "PUBLIC");

        const config = await client.storage.getSignedUrl("default/public/report.txt");
        expect(config.url).toContain("token=");
        expect(await read("default/public/report.txt")).toBe("PRIVATE");
    });

    it("reads the folder name however it is cased, as the routes match it", async () => {
        await store("Default/notes.txt", "CASED");
        await store("notes.txt", "ROOT NOTES");

        expect(await read("Default/notes.txt")).toBe("CASED");
    });

    describe("the spellings that already worked keep their meaning", () => {
        it("a key at the root", async () => {
            expect(await read("photo.png")).toBe("ROOT");
        });

        it("a storageUrl, whose `default` is the bucket", async () => {
            expect(await read("local://default/photo.png")).toBe("ROOT");
            expect(await read("local://default/default/photo.png")).toBe("NESTED");
        });

        it("a delete by storageUrl", async () => {
            await client.storage.deleteObject("local://default/photo.png");

            expect(exists("photo.png")).toBe(false);
            expect(exists("default/photo.png")).toBe(true);
        });

        it("a key whose first folder only begins with `default`", async () => {
            await store("defaults/photo.png", "DEFAULTS");
            expect(await read("defaults/photo.png")).toBe("DEFAULTS");
        });
    });
});
