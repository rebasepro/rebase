import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
/**
 * The bucket means one thing, everywhere — and it never means "somewhere else".
 *
 * `canonicalStorageKey` closed the key axis of an upload request. The same
 * request carries a second caller-controlled routing value, and nothing looked
 * at it: `LocalStorageController.getFullPath` built `join(basePath, bucket)`
 * and then checked containment against *that*, so `bucket = "../../etc"` moved
 * the boundary instead of crossing it and the traversal guard approved
 * `/etc/passwd`. Three entry points fed it — the multipart body, the
 * `?bucket=` query on `/list`, and the TUS `Upload-Metadata` header.
 *
 * Two independent defences are asserted here, because the audit's point was
 * that one of them was reasoning about a value the attacker supplied:
 *  - the route boundary refuses a bucket that is not a bucket name (400), and
 *  - the controller's containment check resolves against the storage root, so
 *    it holds even for a caller that never went through a route.
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
    canonicalStorageBucket,
    InvalidStorageBucketError,
    MAX_STORAGE_BUCKET_LENGTH
} from "../src/storage/keys";

describe("canonicalStorageBucket", () => {
    it.each([
        "default",
        "media",
        "my-bucket",
        "my.bucket.name",
        "with_underscore",
        "b1"
    ])("accepts %s unchanged", (input) => {
        expect(canonicalStorageBucket(input)).toBe(input);
    });

    it.each([undefined, null, ""])("reads %p as 'the caller named no bucket'", (input) => {
        expect(canonicalStorageBucket(input)).toBeUndefined();
    });

    describe("refuses anything that is not a single bucket name", () => {
        it.each([
            "..",
            "../etc",
            "../../../../etc",
            "..\\etc",
            "a/b",
            "a\\b",
            "/absolute",
            ".tus-uploads",
            ".",
            "-leading-dash",
            "bucket name",
            "b\0ucket"
        ])("rejects %j", (input) => {
            expect(() => canonicalStorageBucket(input)).toThrow(InvalidStorageBucketError);
        });

        it("rejects an over-long name rather than truncating it into another bucket", () => {
            expect(() => canonicalStorageBucket("a".repeat(MAX_STORAGE_BUCKET_LENGTH + 1)))
                .toThrow(InvalidStorageBucketError);
        });
    });
});

describe("LocalStorageController — the containment check does not move with the bucket", () => {
    let root: string;
    let storageDir: string;
    let controller: LocalStorageController;

    beforeEach(async () => {
        root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-bucket-"));
        storageDir = path.join(root, "storage");
        await fs.promises.mkdir(storageDir);
        controller = new LocalStorageController({ basePath: storageDir });
    });

    afterEach(async () => {
        await fs.promises.rm(root, { recursive: true, force: true });
    });

    it("refuses to resolve a path outside the storage root via the bucket", () => {
        // The guard used to compute `bucketPath` from this and then check the
        // result against it, which is always true.
        expect(() => controller.getAbsolutePath("passwd", "../../../../etc"))
            .toThrow(/traversal/i);
    });

    it("refuses to resolve one directory up, the smallest useful escape", () => {
        expect(() => controller.getAbsolutePath("index.js", "..")).toThrow(/traversal/i);
    });

    it("refuses to write outside the storage root via the bucket", async () => {
        const file = new File([Buffer.from("attacker js")], "index.js", { type: "text/javascript" });

        await expect(controller.putObject({ file, key: "index.js", bucket: "../escaped" }))
            .rejects.toThrow(/traversal/i);

        const escaped = await fs.promises
            .access(path.join(root, "escaped", "index.js"))
            .then(() => true)
            .catch(() => false);
        expect(escaped).toBe(false);
    });

    it("still resolves an ordinary named bucket", () => {
        expect(controller.getAbsolutePath("a/b.txt", "media"))
            .toBe(path.join(storageDir, "media", "a", "b.txt"));
    });

    it("treats an empty bucket as the default one, not as the storage root", async () => {
        // `?? DEFAULT_BUCKET` kept `""`, so an empty form field stored objects
        // one level above every reader that looks in `default/`.
        await controller.putObject({
            file: new File([Buffer.from("hi")], "x.txt", { type: "text/plain" }),
            key: "x.txt",
            bucket: ""
        });

        expect(await fs.promises.readFile(path.join(storageDir, "default", "x.txt"), "utf-8")).toBe("hi");
    });
});

describe("storage routes refuse a traversing bucket at every entry point", () => {
    let app: Hono<HonoEnv>;
    let root: string;
    let storageDir: string;

    /** Base64 the way the `Upload-Metadata` header carries values. */
    const meta = (pairs: Record<string, string>): string =>
        Object.entries(pairs)
            .map(([k, v]) => `${k} ${Buffer.from(v, "utf-8").toString("base64")}`)
            .join(",");

    /** Anything written here escaped the storage root. */
    const escapedDir = () => path.join(root, "escaped");

    beforeEach(async () => {
        configureJwt({ secret: "test-secret-key-for-jwt-testing-1234567890" });
        root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-bucket-routes-"));
        storageDir = path.join(root, "storage");
        await fs.promises.mkdir(storageDir);
        await fs.promises.mkdir(escapedDir());
        await fs.promises.writeFile(path.join(escapedDir(), "app.js"), "the real app");

        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({
            controller: new LocalStorageController({ basePath: storageDir }),
            requireAuth: false
        }));
    });

    afterEach(async () => {
        await fs.promises.rm(root, { recursive: true, force: true });
    });

    it("400s an upload naming a bucket outside the root, and writes nothing", async () => {
        const form = new FormData();
        form.append("file", new File([Buffer.from("PWNED")], "app.js", { type: "text/javascript" }));
        form.append("key", "app.js");
        form.append("bucket", "../escaped");

        const res = await app.fetch(new Request("http://localhost/api/storage/upload", {
            method: "POST",
            body: form
        }));

        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: { code: "INVALID_STORAGE_BUCKET" } });
        expect(await fs.promises.readFile(path.join(escapedDir(), "app.js"), "utf-8")).toBe("the real app");
    });

    it("400s a listing naming a bucket outside the root, and enumerates nothing", async () => {
        const res = await app.fetch(
            new Request("http://localhost/api/storage/list?bucket=..%2Fescaped&prefix=")
        );

        expect(res.status).toBe(400);
        expect(await res.text()).not.toContain("app.js");
    });

    it("400s a listing of the TUS temp directory, which sits beside the buckets", async () => {
        const res = await app.fetch(new Request("http://localhost/api/storage/list?bucket=.tus-uploads"));

        expect(res.status).toBe(400);
    });

    it("400s a TUS creation naming a bucket outside the root, leaving no temp file", async () => {
        const res = await app.fetch(new Request("http://localhost/api/storage/tus", {
            method: "POST",
            headers: {
                "Upload-Length": "5",
                "Upload-Metadata": meta({ key: "app.js", bucket: "../escaped" })
            }
        }));

        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: { code: "INVALID_STORAGE_BUCKET" } });
        expect(await fs.promises.readFile(path.join(escapedDir(), "app.js"), "utf-8")).toBe("the real app");
    });

    it("still accepts an ordinary named bucket on upload", async () => {
        const form = new FormData();
        form.append("file", new File([Buffer.from("hello")], "x.txt", { type: "text/plain" }));
        form.append("key", "x.txt");
        form.append("bucket", "media");

        const res = await app.fetch(new Request("http://localhost/api/storage/upload", {
            method: "POST",
            body: form
        }));

        expect(res.status).toBe(201);
        expect(await fs.promises.readFile(path.join(storageDir, "media", "x.txt"), "utf-8")).toBe("hello");
    });
});
