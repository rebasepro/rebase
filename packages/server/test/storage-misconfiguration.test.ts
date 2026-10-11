import { describe, it, expect, jest } from "@jest/globals";
/**
 * A storage source that is wrong — a bucket name with a typo, a type the
 * source does not take — says so.
 *
 * A missing bucket is a 404 on S3 and GCS, and the controllers read every 404
 * as a missing object: a typo in `S3_BUCKET` made every file of the deployment
 * "not found" and every delete a success. On a write it, and an
 * `allowedMimeTypes` refusal, reached the caller as a bare 500.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ApiError } from "../src/api/errors";
import { LocalStorageController } from "../src/storage/LocalStorageController";
import { S3StorageController } from "../src/storage/S3StorageController";
import { GCSStorageController } from "../src/storage/GCSStorageController";
import type { StorageController } from "../src/storage/types";
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

const file = (body = "x", type = "text/plain") => new File([body], "x.txt", { type });

/** Whatever `run` throws, or `undefined`. */
async function thrown(run: () => Promise<unknown>): Promise<unknown> {
    try {
        await run();
        return undefined;
    } catch (error: unknown) {
        return error;
    }
}

function expectMisconfigured(error: unknown, bucket: string): void {
    expect(error).toBeInstanceOf(ApiError);
    if (!(error instanceof ApiError)) return;
    expect(error.statusCode).toBe(502);
    expect(error.code).toBe("STORAGE_MISCONFIGURED");
    expect(error.message).toContain(bucket);
}

const misnamed: Array<[string, () => StorageController]> = [
    ["s3", () => {
        s3World.reset(["acme-media"]);
        return new S3StorageController({ type: "s3", bucket: "acme-meida", accessKeyId: "test", secretAccessKey: "test" });
    }],
    ["gcs", () => {
        gcsWorld.reset(["acme-gcs"]);
        return new GCSStorageController({ type: "gcs", bucket: "acme-gsc" });
    }]
];

describe.each(misnamed)("a bucket that does not exist — %s", (_kind, make) => {
    it("is not a missing file on a read", async () => {
        const controller = make();
        expectMisconfigured(await thrown(() => controller.getObject("a.txt")), "acme-");
    });

    it("is not a successful delete", async () => {
        const controller = make();
        expectMisconfigured(await thrown(() => controller.deleteObject("a.txt")), "acme-");
    });

    it("is not an internal error on a write or a listing", async () => {
        const controller = make();
        expectMisconfigured(await thrown(() => controller.putObject({ file: file(), key: "a.txt" })), "acme-");
        expectMisconfigured(await thrown(() => controller.listObjects("")), "acme-");
    });
});

describe("a type the source does not take", () => {
    it("is refused as a bad request, not an internal error", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-mime-"));
        try {
            const controller = new LocalStorageController({ type: "local", basePath: dir, allowedMimeTypes: ["image/png"] });
            const error = await thrown(() => controller.putObject({ file: file(), key: "a.txt" }));

            expect(error).toBeInstanceOf(ApiError);
            expect(error instanceof ApiError && error.code).toBe("STORAGE_FILE_TYPE_REFUSED");
            expect(error instanceof ApiError && error.statusCode).toBe(400);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
