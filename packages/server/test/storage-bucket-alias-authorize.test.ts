import { describe, it, expect, beforeEach, jest } from "@jest/globals";
/**
 * One bucket, one name — for the `storageAuthorize` hook.
 *
 * S3 and GCS serve one bucket under two names: `"default"` and the provider's
 * own (`acme-media`). Both reach the same objects. The read routes can only
 * ever say `"default"`, but the write routes passed the hook whichever name the
 * caller wrote, so a hook that judged the bucket (`bucket === "default" && …`)
 * was passed by naming the provider's bucket on an upload, a listing, a folder
 * or a TUS upload — into the very objects it guards.
 */
import { Hono } from "hono";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { S3StorageController } from "../src/storage/S3StorageController";
import { GCSStorageController } from "../src/storage/GCSStorageController";
import { createStorageRoutes } from "../src/storage/routes";
import type { StorageController, StorageAuthorizeContext } from "../src/storage/types";
import { s3World, gcsWorld } from "./helpers/fake-object-stores";

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

const b64 = (s: string) => Buffer.from(s).toString("base64");

const stores: Array<[string, string, () => StorageController]> = [
    ["s3", "acme-media", () => {
        s3World.reset(["acme-media"]);
        return new S3StorageController({ type: "s3", bucket: "acme-media", accessKeyId: "test", secretAccessKey: "test" });
    }],
    ["gcs", "acme-gcs", () => {
        gcsWorld.reset(["acme-gcs"]);
        return new GCSStorageController({ type: "gcs", bucket: "acme-gcs" });
    }]
];

describe.each(stores)("the hook is told one bucket name — %s", (_kind, providerBucket, make) => {
    let app: Hono<HonoEnv>;
    let asked: StorageAuthorizeContext[];

    beforeEach(() => {
        asked = [];
        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({
            controller: make(),
            requireAuth: false,
            authorize: async (ctx) => {
                asked.push(ctx);
                return true;
            }
        }));
    });

    it("on an upload naming the provider's bucket", async () => {
        const form = new FormData();
        form.append("file", new File(["x"], "x.txt", { type: "text/plain" }));
        form.append("key", "alice/x.txt");
        form.append("bucket", providerBucket);

        const res = await app.request("/api/storage/upload", { method: "POST", body: form });

        expect(res.status).toBe(201);
        expect(asked.map(a => a.bucket)).toEqual(["default"]);
    });

    it("on a listing naming the provider's bucket", async () => {
        const res = await app.request(`/api/storage/list?prefix=alice&bucket=${providerBucket}`);

        expect(res.status).toBe(200);
        expect(asked.map(a => a.bucket)).toEqual(["default"]);
    });

    it("on a folder naming the provider's bucket", async () => {
        const res = await app.request("/api/storage/folder", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: "alice/new", bucket: providerBucket })
        });

        expect(res.status).toBeLessThan(300);
        expect(asked.map(a => a.bucket)).toEqual(["default"]);
    });

    it("on a TUS upload naming the provider's bucket", async () => {
        const res = await app.request("/api/storage/tus", {
            method: "POST",
            headers: {
                "Tus-Resumable": "1.0.0",
                "Upload-Length": "1",
                "Upload-Metadata": `key ${b64("alice/t.txt")},bucket ${b64(providerBucket)},filetype ${b64("text/plain")}`
            }
        });

        expect(res.status).toBe(201);
        expect(asked.map(a => a.bucket)).toEqual(["default"]);
    });
});
