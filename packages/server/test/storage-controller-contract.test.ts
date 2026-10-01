import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
/**
 * One contract, three controllers.
 *
 * `StorageController` has three implementations and the routes treat them as
 * interchangeable. Every route test used to run against `LocalStorageController`
 * alone — the implementation that happened to work — so the other two could
 * break a promise the routes depend on and stay green:
 *
 *  - S3 and GCS built the object's `File` with no `lastModified`, so every read
 *    was a "new version": a fresh `ETag` per request, no 304 ever, a transform
 *    cache that never hit, and — with the rendition cache on — a new object in
 *    the bucket for every image request.
 *  - On local disk, asking for a folder as if it were a file answered 500 with
 *    the internal error code; S3 and GCS answer 404.
 *  - With `includeBucketUrl`, the stored `s3://<bucket>/<key>` value could not
 *    be read back or deleted on S3 and GCS, only on local disk.
 *
 * The same assertions run against each controller: local for real, S3 and GCS
 * against in-process fakes of their SDK clients
 * (`helpers/fake-object-stores.ts`) that keep the SDK semantics these promises
 * rest on — fixed object versions, lexicographic paged listings, folder
 * markers that come back in their own listing. A promise that holds on one
 * controller and not another fails here, named by the controller it broke on.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Hono } from "hono";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { LocalStorageController } from "../src/storage/LocalStorageController";
import { S3StorageController } from "../src/storage/S3StorageController";
import { GCSStorageController } from "../src/storage/GCSStorageController";
import { createStorageRoutes } from "../src/storage/routes";
import { RENDITION_PREFIX } from "../src/storage/rendition-cache";
import type { StorageController } from "../src/storage/types";
import { configureJwt } from "../src/auth/jwt";
import { createTransport } from "../../client/src/transport";
import { createStorage } from "../../client/src/storage";
import { s3World, gcsWorld } from "./helpers/fake-object-stores";

// Only the client that sends commands is replaced; the command classes are the
// real ones, so the controllers build exactly the requests they build in
// production.
jest.mock("@aws-sdk/client-s3", () => {
    const actual = jest.requireActual<Record<string, unknown>>("@aws-sdk/client-s3");
    const { FakeS3Client } = jest.requireActual<typeof import("./helpers/fake-object-stores")>("./helpers/fake-object-stores");
    return { ...actual, S3Client: FakeS3Client };
});
jest.mock("@aws-sdk/s3-request-presigner", () => ({
    getSignedUrl: jest.requireActual<typeof import("./helpers/fake-object-stores")>("./helpers/fake-object-stores").fakeS3Presign
}));
jest.mock("@google-cloud/storage", () => ({
    Storage: jest.requireActual<typeof import("./helpers/fake-object-stores")>("./helpers/fake-object-stores").FakeGcsStorage
}));

const S3_BUCKET = "acme-media";
const GCS_BUCKET = "acme-gcs";

type Kind = "local" | "s3" | "gcs";

interface Harness {
    controller: StorageController;
    cleanup: () => Promise<void>;
}

async function harness(kind: Kind): Promise<Harness> {
    if (kind === "local") {
        const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-storage-contract-"));
        return {
            controller: new LocalStorageController({ type: "local", basePath: dir }),
            cleanup: () => fs.promises.rm(dir, { recursive: true, force: true })
        };
    }
    if (kind === "s3") {
        s3World.reset([S3_BUCKET]);
        return {
            controller: new S3StorageController({
                type: "s3",
                bucket: S3_BUCKET,
                accessKeyId: "test",
                secretAccessKey: "test"
            }),
            cleanup: async () => undefined
        };
    }
    gcsWorld.reset([GCS_BUCKET]);
    return {
        controller: new GCSStorageController({ type: "gcs", bucket: GCS_BUCKET }),
        cleanup: async () => undefined
    };
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const textFile = (name: string, body: string, type = "text/plain") =>
    new File([Buffer.from(body)], name, { type });

/** A real PNG, so the transform path does real work. */
async function png(): Promise<Buffer> {
    const sharp = (await import("sharp")).default;
    return sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 200, g: 40, b: 40 } } })
        .png()
        .toBuffer();
}

describe.each<Kind>(["local", "s3", "gcs"])("storage controller contract — %s", (kind) => {
    let h: Harness;
    let app: Hono<HonoEnv>;
    let putSpy: jest.SpiedFunction<StorageController["putObject"]>;

    const request = (url: string, init?: RequestInit) => app.request(url, init);

    beforeEach(async () => {
        configureJwt({ secret: "test-secret-key-for-jwt-testing-1234567890" });
        h = await harness(kind);
        putSpy = jest.spyOn(h.controller, "putObject");
        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({
            controller: h.controller,
            requireAuth: false,
            renditionCache: { enabled: true }
        }));
    });

    afterEach(async () => {
        putSpy.mockRestore();
        await h.cleanup();
    });

    // ── Versions ────────────────────────────────────────────────────────

    it("reports one lastModified for an unchanged object, on every read", async () => {
        await h.controller.putObject({ file: textFile("a.txt", "hello"), key: "versions/a.txt" });
        const first = await h.controller.getObject("versions/a.txt");
        await sleep(25);
        const second = await h.controller.getObject("versions/a.txt");

        expect(first).not.toBeNull();
        expect(second!.lastModified).toBe(first!.lastModified);
    });

    it("dates an object by its write, not by the read", async () => {
        await h.controller.putObject({ file: textFile("a.txt", "hello"), key: "versions/a.txt" });
        const writtenBy = Date.now();
        await sleep(25);
        const object = await h.controller.getObject("versions/a.txt");

        expect(object!.lastModified).toBeLessThanOrEqual(writtenBy);
    });

    it("revalidates an unchanged object with a 304", async () => {
        await h.controller.putObject({ file: textFile("a.txt", "hello"), key: "versions/a.txt" });
        const first = await request("/api/storage/file/versions/a.txt");
        const etag = first.headers.get("ETag")!;
        await sleep(25);

        const again = await request("/api/storage/file/versions/a.txt");
        expect(again.headers.get("ETag")).toBe(etag);
        expect(again.headers.get("Last-Modified")).toBe(first.headers.get("Last-Modified"));

        const revalidated = await request("/api/storage/file/versions/a.txt", { headers: { "If-None-Match": etag } });
        expect(revalidated.status).toBe(304);
    });

    it("computes a transform once, and stores one rendition for it", async () => {
        await h.controller.putObject({
            file: new File([new Uint8Array(await png())], "a.png", { type: "image/png" }),
            key: "versions/a.png"
        });

        for (let i = 0; i < 3; i++) {
            const res = await request("/api/storage/file/versions/a.png?width=8");
            expect(res.status).toBe(200);
            await sleep(15);
        }

        const renditionWrites = putSpy.mock.calls.filter(([props]) => props.key.startsWith(RENDITION_PREFIX));
        expect(renditionWrites).toHaveLength(1);
    });

    // ── Reads that are not objects ─────────────────────────────────────

    const createFolder = (folderPath: string) => request("/api/storage/folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: folderPath })
    });

    it("answers 404 for a folder asked for as a file — not 500 and not its metadata", async () => {
        expect((await createFolder("docs")).status).toBe(201);
        await h.controller.putObject({ file: textFile("a.txt", "x"), key: "docs/a.txt" });

        const file = await request("/api/storage/file/docs");
        expect(file.status).toBe(404);
        // The error code is the route's, not the filesystem's.
        expect(JSON.stringify(await file.json())).not.toContain("EISDIR");

        expect((await request("/api/storage/metadata/docs")).status).toBe(404);
    });

    it("reads back what it stored, and nothing for a missing key", async () => {
        await h.controller.putObject({ file: textFile("a.txt", "hello", "text/plain"), key: "rt/a.txt" });
        const object = await h.controller.getObject("rt/a.txt");

        expect(Buffer.from(await object!.arrayBuffer()).toString()).toBe("hello");
        expect(object!.type).toBe("text/plain");
        expect(await h.controller.getObject("rt/missing.txt")).toBeNull();
        await expect(h.controller.deleteObject("rt/missing.txt")).resolves.toBeUndefined();
    });
});
