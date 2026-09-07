import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Hono } from "hono";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { LocalStorageController } from "../src/storage/LocalStorageController";
import { S3StorageController } from "../src/storage/S3StorageController";
import { createStorageRoutes } from "../src/storage/routes";

/**
 * A bucket this deployment does not serve is not "file not found".
 *
 * `getSignedUrl("x.txt", "no-such-bucket")` answered `{ url: null, fileNotFound:
 * true }` — byte for byte what a key that genuinely does not exist answers — so
 * a caller had no way to learn the second argument was the problem. The listing
 * had the same shape of silence: an unknown bucket enumerated an empty
 * directory and returned `{ items: [], prefixes: [] }`.
 *
 * On S3 it was more than a diagnostics problem. `getBucket()` passes any name
 * that is not `default` straight through, so the request parameter addressed
 * *any* bucket the deployment's credentials could reach.
 */
describe("a bucket this deployment does not serve", () => {
    let root: string;
    let storageDir: string;
    let app: Hono<HonoEnv>;

    beforeEach(async () => {
        root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-unknown-bucket-"));
        storageDir = path.join(root, "storage");
        await fs.promises.mkdir(path.join(storageDir, "media"), { recursive: true });

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

    it("is a 404 UNKNOWN_STORAGE_SOURCE on a listing, not an empty one", async () => {
        const res = await app.request("/api/storage/list?bucket=no-such-bucket");

        expect(res.status).toBe(404);
        const body = await res.json() as {
            error: { code: string; message: string; details?: { bucket?: string; knownBuckets?: string[] } }
        };
        expect(body.error.code).toBe("UNKNOWN_STORAGE_SOURCE");
        expect(body.error.message).toContain("no-such-bucket");
        expect(body.error.details?.bucket).toBe("no-such-bucket");
    });

    it("names what this deployment does serve", async () => {
        const res = await app.request("/api/storage/list?bucket=no-such-bucket");
        const body = await res.json() as { error: { message: string; details?: { knownBuckets?: string[] } } };

        expect(body.error.details?.knownBuckets).toEqual(expect.arrayContaining(["default", "media"]));
        expect(body.error.message).toContain("\"media\"");
        // And says which axis a second store actually lives on.
        expect(body.error.message).toContain("storageId");
    });

    it("lets a bucket that does exist through", async () => {
        expect((await app.request("/api/storage/list?bucket=media")).status).toBe(200);
        expect((await app.request("/api/storage/list?bucket=default")).status).toBe(200);
        expect((await app.request("/api/storage/list")).status).toBe(200);
    });

    it("still lets a write create one", async () => {
        // A local bucket is a directory, and `putObject` makes it. Only a read
        // has something to compare a name against.
        const form = new FormData();
        form.append("file", new File([Buffer.from("hi")], "x.txt", { type: "text/plain" }));
        form.append("key", "x.txt");
        form.append("bucket", "reports");

        const res = await app.fetch(new Request("http://localhost/api/storage/upload", {
            method: "POST", body: form
        }));

        expect(res.status).toBe(201);
        expect((await app.request("/api/storage/list?bucket=reports")).status).toBe(200);
    });
});

describe("knownBuckets", () => {
    it("local reports the directories that exist, plus default", async () => {
        const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-known-buckets-"));
        try {
            await fs.promises.mkdir(path.join(dir, "media"));
            await fs.promises.writeFile(path.join(dir, "loose.txt"), "not a bucket");

            const controller = new LocalStorageController({ basePath: dir });
            expect(controller.knownBuckets().sort()).toEqual(["default", "media"]);
        } finally {
            await fs.promises.rm(dir, { recursive: true, force: true });
        }
    });

    it("local reports `default` before anything has been written", () => {
        const controller = new LocalStorageController({ basePath: path.join(os.tmpdir(), "rebase-nothing-here") });
        expect(controller.knownBuckets()).toEqual(["default"]);
    });

    it("s3 reports the configured bucket and the logical default, and nothing else", () => {
        const controller = new S3StorageController({
            bucket: "app-uploads",
            region: "us-east-1",
            accessKeyId: "x",
            secretAccessKey: "y"
        });
        expect(controller.knownBuckets()).toEqual(["default", "app-uploads"]);
        // The point: a name that is not one of these went to S3 as a bucket.
        expect(controller.knownBuckets()).not.toContain("someone-elses-bucket");
    });
});
