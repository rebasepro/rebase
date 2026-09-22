import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/** Every command the S3 controller sent, with the bucket it named. */
const s3Sent: Array<{ command: string; bucket: unknown }> = [];

// The real controller, with only the wire replaced: what these tests care about
// is which bucket a request reached the provider with, and that is the input
// the controller hands the SDK.
jest.mock("@aws-sdk/client-s3", () => {
    const command = (name: string) => function (this: { name: string; input: Record<string, unknown> }, input: Record<string, unknown>) {
        this.name = name;
        this.input = input;
    };
    return {
        S3Client: function () {
            return {
                send: async (sent: { name: string; input: Record<string, unknown> }) => {
                    s3Sent.push({ command: sent.name, bucket: sent.input.Bucket });
                    return { Contents: [], CommonPrefixes: [] };
                }
            };
        },
        PutObjectCommand: command("PutObject"),
        GetObjectCommand: command("GetObject"),
        DeleteObjectCommand: command("DeleteObject"),
        ListObjectsV2Command: command("ListObjectsV2"),
        HeadObjectCommand: command("HeadObject")
    };
});

import { Hono } from "hono";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { LocalStorageController } from "../src/storage/LocalStorageController";
import { S3StorageController } from "../src/storage/S3StorageController";
import { DefaultStorageRegistry } from "../src/storage/storage-registry";
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

/**
 * A write names a bucket too, and on an object store it names one at the
 * provider.
 *
 * Only reads and listings were compared against `knownBuckets()`: a write was
 * checked for shape alone, because a local bucket is a directory the write
 * creates. That reasoning is local's. On S3 and GCS the name went to the
 * provider as given, so `bucket=prod-db-backups` on an upload, a folder or a
 * resumable upload wrote into whatever other bucket the deployment's
 * credentials reach — while a listing of the same name answered 404.
 */
describe("a write naming a bucket an object store does not serve", () => {
    let tusRoot: string;
    let app: Hono<HonoEnv>;

    const puts = () => s3Sent.filter(s => s.command === "PutObject").map(s => s.bucket);

    const tusCreate = (metadata: Record<string, string>, query = "") => app.fetch(new Request(
        `http://localhost/api/storage/tus${query}`,
        {
            method: "POST",
            headers: {
                "Tus-Resumable": "1.0.0",
                "Upload-Length": "3",
                "Upload-Metadata": Object.entries(metadata)
                    .map(([k, v]) => `${k} ${Buffer.from(v).toString("base64")}`)
                    .join(",")
            }
        }
    ));

    const s3 = () => new S3StorageController({
        bucket: "app-uploads",
        region: "us-east-1",
        accessKeyId: "x",
        secretAccessKey: "y"
    });

    beforeEach(async () => {
        s3Sent.length = 0;
        tusRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-foreign-bucket-"));
        process.env.STORAGE_PATH = tusRoot;
        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({ controller: s3(), requireAuth: false }));
    });

    afterEach(async () => {
        delete process.env.STORAGE_PATH;
        await fs.promises.rm(tusRoot, { recursive: true, force: true });
    });

    it("refuses an upload with 404 UNKNOWN_STORAGE_SOURCE and sends nothing", async () => {
        const form = new FormData();
        form.append("file", new File(["pwned"], "x.txt", { type: "text/plain" }));
        form.append("key", "latest.sql.gz");
        form.append("bucket", "prod-db-backups");

        const res = await app.fetch(new Request("http://localhost/api/storage/upload", { method: "POST", body: form }));

        expect(res.status).toBe(404);
        expect(await res.json()).toMatchObject({
            error: { code: "UNKNOWN_STORAGE_SOURCE", details: { bucket: "prod-db-backups" } }
        });
        expect(puts()).toEqual([]);
    });

    it("refuses a folder", async () => {
        const res = await app.fetch(new Request("http://localhost/api/storage/folder", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: "x", bucket: "prod-db-backups" })
        }));

        expect(res.status).toBe(404);
        expect(await res.json()).toMatchObject({ error: { code: "UNKNOWN_STORAGE_SOURCE" } });
        expect(puts()).toEqual([]);
    });

    it("refuses a resumable upload at creation, before a byte is sent", async () => {
        const res = await tusCreate({ key: "t.txt", bucket: "prod-db-backups" });

        expect(res.status).toBe(404);
        expect(await res.json()).toMatchObject({ error: { code: "UNKNOWN_STORAGE_SOURCE" } });
        expect(fs.existsSync(path.join(tusRoot, ".tus-uploads"))
            ? fs.readdirSync(path.join(tusRoot, ".tus-uploads"))
            : []).toEqual([]);
    });

    it("refuses it on a named source too", async () => {
        const localDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-foreign-bucket-local-"));
        try {
            const multi = new Hono<HonoEnv>();
            multi.onError(errorHandler);
            multi.route("/api/storage", createStorageRoutes({
                registry: DefaultStorageRegistry.create({
                    "(default)": new LocalStorageController({ basePath: localDir }),
                    media: s3()
                }),
                requireAuth: false
            }));
            app = multi;

            const res = await tusCreate({ key: "t.txt", bucket: "prod-db-backups", storageId: "media" });

            expect(res.status).toBe(404);
            expect(await res.json()).toMatchObject({ error: { code: "UNKNOWN_STORAGE_SOURCE" } });
        } finally {
            await fs.promises.rm(localDir, { recursive: true, force: true });
        }
    });

    it("still writes to the bucket it serves, by name or as `default`", async () => {
        for (const bucket of ["app-uploads", "default"]) {
            const form = new FormData();
            form.append("file", new File(["hi"], "x.txt", { type: "text/plain" }));
            form.append("key", "x.txt");
            form.append("bucket", bucket);

            const res = await app.fetch(new Request("http://localhost/api/storage/upload", { method: "POST", body: form }));
            expect(res.status).toBe(201);
        }

        expect((await tusCreate({ key: "t.txt", bucket: "app-uploads" })).status).toBe(201);
        expect(puts()).toEqual(["app-uploads", "app-uploads"]);
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
