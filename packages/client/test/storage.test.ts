import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { createStorage } from "../src/storage";
import { Transport } from "../src/transport";

function createMockTransport(): jest.Mocked<Transport> {
    return {
        request: jest.fn(),
        fetchFn: jest.fn(),
        baseUrl: "http://localhost:3000",
        apiPath: "/api",
        resolveToken: jest.fn(),
        getHeaders: jest.fn().mockReturnValue({ Authorization: "Bearer token" }),
        setToken: jest.fn(),
        setAuthTokenGetter: jest.fn()
    } as unknown as jest.Mocked<Transport>;
}

describe("Storage", () => {
    let mockTransport: jest.Mocked<Transport>;

    beforeEach(() => {
        mockTransport = createMockTransport();
    });

    // -----------------------------------------------------------------------
    // putObject
    // -----------------------------------------------------------------------
    describe("putObject", () => {
        it("uploads a file and returns the result", async () => {
            const storage = createStorage(mockTransport);
            const mockFile = new File(["content"], "test.txt", { type: "text/plain" });

            mockTransport.request.mockResolvedValueOnce({
                data: { key: "uploads/test.txt" }
            });

            const result = await storage.putObject({
                file: mockFile,
                key: "uploads/test.txt",
                bucket: "my-bucket",
                metadata: { customField: "value1",
numericField: 123 }
            });

            expect(mockTransport.request).toHaveBeenCalledWith("/storage/upload", expect.objectContaining({
                method: "POST",
                body: expect.any(FormData)
            }));
            expect(result).toEqual({ key: "uploads/test.txt" });
        });

        it("appends all FormData fields correctly", async () => {
            const storage = createStorage(mockTransport);
            const mockFile = new File(["data"], "photo.jpg", { type: "image/jpeg" });

            mockTransport.request.mockResolvedValueOnce({ data: {} });

            await storage.putObject({
                file: mockFile,
                key: "images/photo.jpg",
                bucket: "media",
                metadata: { alt: "A photo",
width: 800 }
            });

            const formData = mockTransport.request.mock.calls[0][1]!.body as FormData;
            expect(formData.get("file")).toBeDefined();
            expect(formData.get("key")).toBe("images/photo.jpg");
            expect(formData.get("bucket")).toBe("media");
            expect(formData.get("metadata_alt")).toBe("A photo");
            expect(formData.get("metadata_width")).toBe("800"); // JSON.stringify for non-string
        });

        it("handles upload without optional parameters", async () => {
            const storage = createStorage(mockTransport);
            const mockFile = new File(["data"], "file.bin");

            mockTransport.request.mockResolvedValueOnce({ data: { key: "file.bin" } });

            const result = await storage.putObject({ file: mockFile,
key: "file.bin" });
            expect(result).toEqual({ key: "file.bin" });

            const formData = mockTransport.request.mock.calls[0][1]!.body as FormData;
            expect(formData.get("file")).toBeDefined();
            expect(formData.get("key")).toBe("file.bin");
            expect(formData.get("bucket")).toBeNull();
        });

        it("skips null/undefined metadata values", async () => {
            const storage = createStorage(mockTransport);
            const mockFile = new File(["data"], "file.bin");

            mockTransport.request.mockResolvedValueOnce({ data: {} });

            await storage.putObject({
                file: mockFile,
                key: "file.bin",
                metadata: { valid: "yes",
nope: undefined,
alsoNope: null } as any
            });

            const formData = mockTransport.request.mock.calls[0][1]!.body as FormData;
            expect(formData.get("metadata_valid")).toBe("yes");
            expect(formData.get("metadata_nope")).toBeNull();
            expect(formData.get("metadata_alsoNope")).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // getSignedUrl
    // -----------------------------------------------------------------------
    describe("getSignedUrl", () => {
        it("uses the server's scoped download token, never the access token", async () => {
            const storage = createStorage(mockTransport);

            // Scoped token arrives in the metadata payload; the access token
            // (resolveToken) must NEVER end up in a URL.
            mockTransport.request.mockResolvedValueOnce({ data: { size: 100, token: "my-token" } });
            mockTransport.resolveToken.mockResolvedValueOnce("ACCESS-JWT");

            const result = await storage.getSignedUrl("file.jpg", "bucket");

            expect(mockTransport.request).toHaveBeenCalledWith("/storage/metadata/bucket/file.jpg");
            expect(result).toEqual({
                url: "http://localhost:3000/api/storage/file/bucket/file.jpg?token=my-token",
                metadata: { size: 100, token: "my-token" }
            });
            expect(result.url).not.toContain("ACCESS-JWT");
        });

        it("builds file URLs against storageUrlOrigin when set, while API requests keep baseUrl", async () => {
            // Proxied setups (the console's Studio embed): metadata goes through
            // the authenticated proxy at baseUrl, but the returned file URL must
            // point at the tenant itself — an <img src> can't satisfy the
            // proxy's auth, and the file route carries its own scoped token.
            (mockTransport as unknown as { storageUrlOrigin?: string }).storageUrlOrigin = "https://tenant.example";
            const storage = createStorage(mockTransport);

            mockTransport.request.mockResolvedValueOnce({ data: { size: 1, token: "tok" } });
            mockTransport.resolveToken.mockResolvedValueOnce(null);

            const result = await storage.getSignedUrl("file.jpg");

            expect(mockTransport.request).toHaveBeenCalledWith("/storage/metadata/file.jpg");
            expect(result.url).toBe("https://tenant.example/api/storage/file/file.jpg?token=tok");
        });

        it("strips local:// prefix", async () => {
            const storage = createStorage(mockTransport);

            mockTransport.request.mockResolvedValueOnce({ data: { size: 100 } });
            mockTransport.resolveToken.mockResolvedValueOnce(null);

            const result = await storage.getSignedUrl("local://file.jpg");

            expect(mockTransport.request).toHaveBeenCalledWith("/storage/metadata/file.jpg");
            expect(result).toEqual({
                url: "http://localhost:3000/api/storage/file/file.jpg",
                metadata: { size: 100 }
            });
        });

        it("strips s3:// prefix", async () => {
            const storage = createStorage(mockTransport);

            mockTransport.request.mockResolvedValueOnce({ data: {} });
            mockTransport.resolveToken.mockResolvedValueOnce(null);

            await storage.getSignedUrl("s3://bucket/file.jpg");

            expect(mockTransport.request).toHaveBeenCalledWith("/storage/metadata/bucket/file.jpg");
        });

        it("does not duplicate bucket prefix if already present", async () => {
            const storage = createStorage(mockTransport);

            mockTransport.request.mockResolvedValueOnce({ data: {} });
            mockTransport.resolveToken.mockResolvedValueOnce(null);

            await storage.getSignedUrl("mybucket/file.jpg", "mybucket");

            expect(mockTransport.request).toHaveBeenCalledWith("/storage/metadata/mybucket/file.jpg");
        });

        it("omits token query when no token available", async () => {
            const storage = createStorage(mockTransport);

            mockTransport.request.mockResolvedValueOnce({ data: {} });
            mockTransport.resolveToken.mockResolvedValueOnce(null);

            const result = await storage.getSignedUrl("file.jpg");
            expect(result.url).toBe("http://localhost:3000/api/storage/file/file.jpg");
            expect(result.url).not.toContain("?token=");
        });

        it("appends storageId with ? when there is no token", async () => {
            // Regression: a hand-built `&storageId` produced an invalid URL
            // (no `?`) when no auth token was present.
            const storage = createStorage(mockTransport, "media");

            mockTransport.request.mockResolvedValueOnce({ data: {} });
            mockTransport.resolveToken.mockResolvedValueOnce(null);

            const result = await storage.getSignedUrl("file.jpg");
            expect(result.url).toBe("http://localhost:3000/api/storage/file/file.jpg?storageId=media");
        });

        it("appends storageId with & when a scoped token is present", async () => {
            const storage = createStorage(mockTransport, "media");

            mockTransport.request.mockResolvedValueOnce({ data: { token: "tok" } });

            const result = await storage.getSignedUrl("file.jpg");
            expect(result.url).toBe("http://localhost:3000/api/storage/file/file.jpg?token=tok&storageId=media");
        });

        it("public objects get a token-less permanent URL with no metadata round-trip", async () => {
            const storage = createStorage(mockTransport);
            mockTransport.resolveToken.mockResolvedValue("ACCESS-JWT");

            const result = await storage.getSignedUrl("public/avatar.png");

            // No /storage/metadata request at all — the path is self-describing.
            expect(mockTransport.request).not.toHaveBeenCalled();
            expect(result.url).toBe("http://localhost:3000/api/storage/file/public/avatar.png");
            expect(result.url).not.toContain("token=");
        });

        it("honours a server-confirmed public flag (token-less URL)", async () => {
            const storage = createStorage(mockTransport);
            // A path not obviously public, but the server marks it public.
            mockTransport.request.mockResolvedValueOnce({ data: { size: 10, public: true, token: "should-be-ignored" } });

            const result = await storage.getSignedUrl("assets/logo.png");
            expect(result.url).toBe("http://localhost:3000/api/storage/file/assets/logo.png");
            expect(result.url).not.toContain("token=");
        });

        it("returns cached result on subsequent calls", async () => {
            const storage = createStorage(mockTransport);

            mockTransport.request.mockResolvedValueOnce({ data: { size: 50 } });
            mockTransport.resolveToken.mockResolvedValueOnce("tok");

            const first = await storage.getSignedUrl("cached.jpg");
            const second = await storage.getSignedUrl("cached.jpg");

            expect(first).toEqual(second);
            expect(mockTransport.request).toHaveBeenCalledTimes(1); // Only one actual request
        });

        it("uses separate cache keys for different buckets", async () => {
            const storage = createStorage(mockTransport);

            mockTransport.request.mockResolvedValueOnce({ data: { size: 1 } });
            mockTransport.resolveToken.mockResolvedValueOnce(null);
            await storage.getSignedUrl("file.jpg", "bucket-a");

            mockTransport.request.mockResolvedValueOnce({ data: { size: 2 } });
            mockTransport.resolveToken.mockResolvedValueOnce(null);
            await storage.getSignedUrl("file.jpg", "bucket-b");

            expect(mockTransport.request).toHaveBeenCalledTimes(2);
        });

        it("handles 404 cleanly", async () => {
            const storage = createStorage(mockTransport);

            const error = new Error("Not Found");
            (error as any).status = 404;
            mockTransport.request.mockRejectedValueOnce(error);

            const result = await storage.getSignedUrl("missing.jpg");
            expect(result).toEqual({ url: null,
fileNotFound: true });
        });

        it("rethrows non-404 errors", async () => {
            const storage = createStorage(mockTransport);

            const error = new Error("Server Error");
            (error as any).status = 500;
            mockTransport.request.mockRejectedValueOnce(error);

            await expect(storage.getSignedUrl("error.jpg")).rejects.toThrow("Server Error");
        });
    });

    // -----------------------------------------------------------------------
    // getObject
    // -----------------------------------------------------------------------
    describe("getObject", () => {
        beforeEach(() => {
            // Scoped download token arrives via the metadata response (not the
            // access token), matching the secure server-mediated model.
            mockTransport.request.mockResolvedValue({ data: { token: "token" } } as any);
            mockTransport.resolveToken.mockResolvedValue("token");
        });

        it("returns a File object on success", async () => {
            const storage = createStorage(mockTransport);
            const mockBlob = new Blob(["content"], { type: "text/plain" });

            mockTransport.fetchFn.mockResolvedValueOnce({
                ok: true,
                status: 200,
                blob: async () => mockBlob
            } as any);

            const result = await storage.getObject("my_file.txt");

            expect(mockTransport.fetchFn).toHaveBeenCalledWith(
                "http://localhost:3000/api/storage/file/my_file.txt?token=token",
                { headers: {} }
            );

            expect(result).toBeInstanceOf(File);
            expect(result?.name).toBe("my_file.txt");
            expect(result?.type).toBe("text/plain");
        });

        it("returns null on 404", async () => {
            const storage = createStorage(mockTransport);

            mockTransport.fetchFn.mockResolvedValueOnce({
                status: 404,
                ok: false
            } as any);

            const result = await storage.getObject("missing.txt");
            expect(result).toBeNull();
        });

        it("throws error on non-ok status", async () => {
            const storage = createStorage(mockTransport);

            mockTransport.fetchFn.mockResolvedValueOnce({
                status: 500,
                ok: false
            } as any);

            await expect(storage.getObject("error.txt")).rejects.toThrow("Failed to get file");
        });

        it("strips local:// prefix", async () => {
            const storage = createStorage(mockTransport);
            const mockBlob = new Blob(["x"]);

            mockTransport.fetchFn.mockResolvedValueOnce({
                ok: true,
                status: 200,
                blob: async () => mockBlob
            } as any);

            await storage.getObject("local://images/photo.jpg");

            expect(mockTransport.fetchFn).toHaveBeenCalledWith(
                "http://localhost:3000/api/storage/file/images/photo.jpg?token=token",
                expect.any(Object)
            );
        });

        it("strips s3:// prefix", async () => {
            const storage = createStorage(mockTransport);
            const mockBlob = new Blob(["x"]);

            mockTransport.fetchFn.mockResolvedValueOnce({
                ok: true,
                status: 200,
                blob: async () => mockBlob
            } as any);

            await storage.getObject("s3://bucket/file.dat");

            expect(mockTransport.fetchFn).toHaveBeenCalledWith(
                "http://localhost:3000/api/storage/file/bucket/file.dat?token=token",
                expect.any(Object)
            );
        });

        it("prepends bucket prefix when specified", async () => {
            const storage = createStorage(mockTransport);
            const mockBlob = new Blob(["x"]);

            mockTransport.fetchFn.mockResolvedValueOnce({
                ok: true,
                status: 200,
                blob: async () => mockBlob
            } as any);

            await storage.getObject("photo.jpg", "media");

            expect(mockTransport.fetchFn).toHaveBeenCalledWith(
                "http://localhost:3000/api/storage/file/media/photo.jpg?token=token",
                expect.any(Object)
            );
        });

        it("does not duplicate bucket prefix if already present", async () => {
            const storage = createStorage(mockTransport);
            const mockBlob = new Blob(["x"]);

            mockTransport.fetchFn.mockResolvedValueOnce({
                ok: true,
                status: 200,
                blob: async () => mockBlob
            } as any);

            await storage.getObject("media/photo.jpg", "media");

            expect(mockTransport.fetchFn).toHaveBeenCalledWith(
                "http://localhost:3000/api/storage/file/media/photo.jpg?token=token",
                expect.any(Object)
            );
        });

        it("uses filename from path for File name", async () => {
            const storage = createStorage(mockTransport);
            const mockBlob = new Blob(["x"], { type: "image/png" });

            mockTransport.fetchFn.mockResolvedValueOnce({
                ok: true,
                status: 200,
                blob: async () => mockBlob
            } as any);

            const result = await storage.getObject("deep/nested/image.png");
            expect(result?.name).toBe("image.png");
        });
    });

    // -----------------------------------------------------------------------
    // deleteObject
    // -----------------------------------------------------------------------
    describe("deleteObject", () => {
        it("calls delete request and clears cache", async () => {
            const storage = createStorage(mockTransport);

            // Pre-warm the cache from a get call
            mockTransport.request.mockResolvedValueOnce({ data: {} });
            mockTransport.resolveToken.mockResolvedValueOnce(null);
            await storage.getSignedUrl("file.txt", "bucket");

            mockTransport.request.mockResolvedValueOnce({});
            await storage.deleteObject("file.txt", "bucket");

            expect(mockTransport.request).toHaveBeenCalledWith("/storage/file/bucket/file.txt", { method: "DELETE" });

            // Ensure cache is cleared by verifying a new request is made
            mockTransport.request.mockResolvedValueOnce({ data: {} });
            mockTransport.resolveToken.mockResolvedValueOnce(null);
            await storage.getSignedUrl("file.txt", "bucket");
            expect(mockTransport.request).toHaveBeenCalledTimes(3); // 1st meta + delete + 2nd meta
        });

        it("ignores 404 errors", async () => {
            const storage = createStorage(mockTransport);

            const error = new Error("Not Found");
            (error as any).status = 404;
            mockTransport.request.mockRejectedValueOnce(error);

            await expect(storage.deleteObject("missing.txt")).resolves.toBeUndefined();
        });

        it("throws other errors", async () => {
            const storage = createStorage(mockTransport);

            const error = new Error("Server Error");
            (error as any).status = 500;
            mockTransport.request.mockRejectedValueOnce(error);

            await expect(storage.deleteObject("error.txt")).rejects.toThrow("Server Error");
        });

        it("strips local:// prefix on delete", async () => {
            const storage = createStorage(mockTransport);
            mockTransport.request.mockResolvedValueOnce({});

            await storage.deleteObject("local://files/doc.pdf");
            expect(mockTransport.request).toHaveBeenCalledWith("/storage/file/files/doc.pdf", { method: "DELETE" });
        });

        it("prepends bucket prefix on delete", async () => {
            const storage = createStorage(mockTransport);
            mockTransport.request.mockResolvedValueOnce({});

            await storage.deleteObject("doc.pdf", "docs");
            expect(mockTransport.request).toHaveBeenCalledWith("/storage/file/docs/doc.pdf", { method: "DELETE" });
        });
    });

    // -----------------------------------------------------------------------
    // list
    // -----------------------------------------------------------------------
    describe("list", () => {
        it("builds correct query params", async () => {
            const storage = createStorage(mockTransport);

            mockTransport.request.mockResolvedValueOnce({
                data: { files: [],
nextPageToken: "token" }
            });

            const result = await storage.listObjects("folder/", {
                bucket: "my-bucket",
                maxResults: 10,
                pageToken: "startToken"
            });

            expect(mockTransport.request).toHaveBeenCalledWith("/storage/list?prefix=folder%2F&bucket=my-bucket&maxResults=10&pageToken=startToken");
            expect(result).toEqual({ files: [],
nextPageToken: "token" });
        });

        it("works without options", async () => {
            const storage = createStorage(mockTransport);

            mockTransport.request.mockResolvedValueOnce({
                data: { files: [{ name: "a.txt" }] }
            });

            const result = await storage.listObjects("uploads/");
            expect(mockTransport.request).toHaveBeenCalledWith("/storage/list?prefix=uploads%2F");
            expect(result).toEqual({ files: [{ name: "a.txt" }] });
        });

        it("handles empty path", async () => {
            const storage = createStorage(mockTransport);

            mockTransport.request.mockResolvedValueOnce({ data: { files: [] } });

            await storage.listObjects("");
            // Path would be empty, so it should still call with the query
            expect(mockTransport.request).toHaveBeenCalledWith(expect.stringContaining("/storage/list?"));
        });
    });
});
