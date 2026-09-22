import { describe, it, expect, beforeEach, jest as vi } from "@jest/globals";
/**
 * `GET /metadata/*` on GCS must not sign a URL.
 *
 * The route returns only the object's metadata and a download token; the
 * client builds the `/file/*` URL itself. It used to get that metadata from
 * `getSignedUrl`, and on Cloud Run — no key file, so the GCS client signs
 * through the IAM Credentials `signBlob` API — every call failed with
 * "Permission 'iam.serviceAccounts.signBlob' denied" unless the runtime account
 * had been granted Token Creator on itself. Every private object's metadata
 * read was a 500, which is every avatar and CV behind `getSignedUrl` on the
 * client.
 */
import { Hono } from "hono";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createStorageRoutes } from "../src/storage/routes";
import { configureJwt } from "../src/auth/jwt";

const mockGetMetadata = vi.fn<() => Promise<unknown>>();
const mockGetSignedUrl = vi.fn<() => Promise<unknown>>();
const mockFile = vi.fn((_path: string) => ({ getMetadata: mockGetMetadata, getSignedUrl: mockGetSignedUrl }));
const mockBucket = vi.fn((_name: string) => ({ file: mockFile }));

vi.mock("@google-cloud/storage", () => ({
    Storage: vi.fn().mockImplementation(function() {
        return { bucket: mockBucket };
    })
}));

import { GCSStorageController } from "../src/storage/GCSStorageController";

/** What the GCS client throws on Cloud Run when it cannot sign. */
const signingDenied = () => Object.assign(
    new Error("Permission 'iam.serviceAccounts.signBlob' denied on resource (or it may not exist)."),
    { name: "SigningError" }
);

const notFound = () => Object.assign(new Error("No such object: uploads/u1/photo/missing.jpg"), { code: 404 });

const KEY = "u1/photo/1790111600465-face.jpeg";

describe("GCSStorageController metadata without signing", () => {
    let controller: GCSStorageController;

    beforeEach(() => {
        vi.clearAllMocks();
        controller = new GCSStorageController({ type: "gcs", bucket: "uploads" });
        mockGetMetadata.mockResolvedValue([{ size: "2048", contentType: "image/jpeg", metadata: { source: "upload" } }]);
        mockGetSignedUrl.mockRejectedValue(signingDenied());
    });

    it("describes an object without asking for a signature", async () => {
        const metadata = await controller.getMetadata(KEY);

        expect(metadata).toEqual({
            bucket: "uploads",
            fullPath: KEY,
            name: "1790111600465-face.jpeg",
            size: 2048,
            contentType: "image/jpeg",
            customMetadata: { source: "upload" }
        });
        expect(mockBucket).toHaveBeenCalledWith("uploads");
        expect(mockFile).toHaveBeenCalledWith(KEY);
        expect(mockGetSignedUrl).not.toHaveBeenCalled();
    });

    it("resolves the default bucket and gs:// keys the way getSignedUrl does", async () => {
        await controller.getMetadata(KEY, "default");
        expect(mockBucket).toHaveBeenLastCalledWith("uploads");

        const metadata = await controller.getMetadata(`gs://other/${KEY}`);
        expect(mockBucket).toHaveBeenLastCalledWith("other");
        expect(metadata?.bucket).toBe("other");
        expect(metadata?.fullPath).toBe(KEY);
    });

    it("answers null for an object that does not exist", async () => {
        mockGetMetadata.mockRejectedValue(notFound());
        expect(await controller.getMetadata("u1/photo/missing.jpg")).toBeNull();
    });

    it("rethrows anything that is not a missing object", async () => {
        mockGetMetadata.mockRejectedValue(Object.assign(new Error("backend unavailable"), { code: 503 }));
        await expect(controller.getMetadata(KEY)).rejects.toThrow("backend unavailable");
    });

    it("still signs when a URL is what was asked for", async () => {
        mockGetSignedUrl.mockResolvedValue(["https://storage.googleapis.com/uploads/signed"]);

        const config = await controller.getSignedUrl(KEY);

        expect(config.url).toBe("https://storage.googleapis.com/uploads/signed");
        expect(config.metadata?.contentType).toBe("image/jpeg");
        expect(mockGetSignedUrl).toHaveBeenCalledWith(expect.objectContaining({ action: "read" }));
    });

    it("reports a missing object from getSignedUrl without trying to sign", async () => {
        mockGetMetadata.mockRejectedValue(notFound());

        expect(await controller.getSignedUrl("u1/photo/missing.jpg")).toEqual({ url: null, fileNotFound: true });
        expect(mockGetSignedUrl).not.toHaveBeenCalled();
    });
});

describe("GET /metadata/* on GCS", () => {
    let app: Hono<HonoEnv>;

    beforeEach(() => {
        vi.clearAllMocks();
        configureJwt({ secret: "test-secret-key-for-jwt-testing-1234567890" });
        mockGetMetadata.mockResolvedValue([{ size: "2048", contentType: "image/jpeg" }]);
        // The production failure: signing is refused. The route must not care.
        mockGetSignedUrl.mockRejectedValue(signingDenied());

        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({
            controller: new GCSStorageController({ type: "gcs", bucket: "uploads" }),
            requireAuth: false
        }));
    });

    it("answers metadata and a download token when signing is denied", async () => {
        const res = await app.fetch(new Request(`http://localhost/api/storage/metadata/default/${KEY}`));

        expect(res.status).toBe(200);
        const body = await res.json() as { data: { contentType: string; size: number; token?: string } };
        expect(body.data.contentType).toBe("image/jpeg");
        expect(body.data.size).toBe(2048);
        expect(typeof body.data.token).toBe("string");
        expect(mockGetSignedUrl).not.toHaveBeenCalled();
    });

    it("answers 404 for a missing object", async () => {
        mockGetMetadata.mockRejectedValue(notFound());

        const res = await app.fetch(new Request("http://localhost/api/storage/metadata/default/u1/photo/missing.jpg"));

        expect(res.status).toBe(404);
    });
});
