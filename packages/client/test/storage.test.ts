import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { storageObjectPath } from "@rebasepro/types";
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
            // FormData.get() returns null for an absent key, and null IS
            // "defined" — so the file part has to be identified by its contents,
            // not merely probed for existence.
            const filePart = formData.get("file") as File;
            expect(filePart).toBeInstanceOf(File);
            expect(filePart.name).toBe("photo.jpg");
            expect(filePart.type).toBe("image/jpeg");
            await expect(filePart.text()).resolves.toBe("data");
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
            const filePart = formData.get("file") as File;
            expect(filePart).toBeInstanceOf(File);
            expect(filePart.name).toBe("file.bin");
            await expect(filePart.text()).resolves.toBe("data");
            expect(formData.get("key")).toBe("file.bin");
            expect(formData.get("bucket")).toBeNull();
        });

        it("stores a public file with no key under the public prefix, named after the file", async () => {
            // The key is optional, and `public: true` promises a permanent,
            // token-less URL. With no key the prefix was never applied, the
            // server named the object after the file at the root, and the
            // "public" upload was a private one.
            const storage = createStorage(mockTransport);
            mockTransport.request.mockResolvedValueOnce({ data: { key: "public/avatar.png" } });

            await storage.putObject({ file: new File(["x"], "avatar.png"), public: true });

            const body = mockTransport.request.mock.calls[0][1]?.body as FormData;
            expect(body.get("key")).toBe("public/avatar.png");
        });

        it("names a public Blob with no key as the upload names it: `blob`", async () => {
            // A Blob appended to FormData travels as a file called "blob", which
            // is the name the server would have stored it under.
            const storage = createStorage(mockTransport);
            mockTransport.request.mockResolvedValueOnce({ data: { key: "public/blob" } });

            await storage.putObject({ file: new Blob(["x"]) as File, public: true });

            const body = mockTransport.request.mock.calls[0][1]?.body as FormData;
            expect((body.get("file") as File).name).toBe("blob");
            expect(body.get("key")).toBe("public/blob");
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

        it("strips s3:// and the source's own bucket", async () => {
            // An `s3://` storageUrl's bucket is the source's own, and the
            // routes address its objects by key — sent along, it was read as
            // part of the key and nothing was found.
            const storage = createStorage(mockTransport);

            mockTransport.request.mockResolvedValueOnce({ data: {} });
            mockTransport.resolveToken.mockResolvedValueOnce(null);

            await storage.getSignedUrl("s3://bucket/file.jpg");

            expect(mockTransport.request).toHaveBeenCalledWith("/storage/metadata/file.jpg");
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
            // The same credential on both calls: the cache belongs to it.
            mockTransport.resolveToken.mockResolvedValue("tok");

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

        // A collection view mounts one preview per row, all in the same tick,
        // and rows share files. Each `/storage/metadata` call is a request
        // against the user's rate-limit budget.
        describe("many previews at once", () => {
            /** What the server answers for one file: a private file's token. */
            const described = { token: "t", tokenExpiresIn: 300 };

            /**
             * A transport whose metadata requests stay open until released,
             * counting them. A batched `POST /storage/metadata` is answered per
             * key, as the server answers it.
             */
            function deferredTransport() {
                const open: { path: string; resolve: () => void }[] = [];
                let peak = 0;
                mockTransport.request.mockImplementation(((path: string, init?: RequestInit) => new Promise(resolve => {
                    const keys = init?.method === "POST" ? (JSON.parse(String(init.body)) as { keys: string[] }).keys : undefined;
                    open.push({
                        path,
                        resolve: () => resolve({ data: keys ? Object.fromEntries(keys.map(key => [key, described])) : described })
                    });
                    peak = Math.max(peak, open.filter(r => r.path !== "done").length);
                })) as unknown as typeof mockTransport.request);
                return {
                    open,
                    get peak() { return peak; },
                    /** Answer every open request; return how many were answered. */
                    async drain() {
                        let answered = 0;
                        while (open.some(r => r.path !== "done")) {
                            for (const r of open.filter(r => r.path !== "done")) {
                                r.resolve();
                                r.path = "done";
                                answered++;
                            }
                            await new Promise(resolve => setTimeout(resolve, 0));
                        }
                        return answered;
                    }
                };
            }

            it("asks once for a file that 50 previews ask for together", async () => {
                const storage = createStorage(mockTransport);
                const backend = deferredTransport();

                const all = Promise.all(Array.from({ length: 50 }, () => storage.getSignedUrl("photos/cat.png")));
                // The lookups read the credential first, and lookups started
                // together are sent together, so the request goes out a tick
                // or two later.
                await new Promise(resolve => setTimeout(resolve, 0));
                await new Promise(resolve => setTimeout(resolve, 0));
                await backend.drain();
                const configs = await all;

                expect(mockTransport.request).toHaveBeenCalledTimes(1);
                expect(new Set(configs.map(c => c.url)).size).toBe(1);
            });

            it("asks for 100 different files together in one request, each with its own token", async () => {
                const storage = createStorage(mockTransport, "media");
                const backend = deferredTransport();

                const all = Promise.all(Array.from({ length: 100 }, (_, i) => storage.getSignedUrl(`photos/${i}.png`)));
                await new Promise(resolve => setTimeout(resolve, 0));
                await new Promise(resolve => setTimeout(resolve, 0));
                expect(await backend.drain()).toBe(1);
                const configs = await all;

                expect(mockTransport.request).toHaveBeenCalledTimes(1);
                expect(mockTransport.request).toHaveBeenCalledWith("/storage/metadata", expect.objectContaining({ method: "POST" }));
                const body = JSON.parse(String(mockTransport.request.mock.calls[0][1]?.body)) as { keys: string[]; storageId?: string };
                expect(body.keys).toHaveLength(100);
                expect(body.storageId).toBe("media");
                expect(configs[42].url).toBe("http://localhost:3000/api/storage/file/photos/42.png?token=t&storageId=media");
            });

            it("keeps a bounded number of metadata requests open at once", async () => {
                const storage = createStorage(mockTransport);
                const backend = deferredTransport();

                // 1,000 files: ten batches of a hundred, at most eight open at once.
                const all = Promise.all(Array.from({ length: 1_000 }, (_, i) => storage.getSignedUrl(`photos/${i}.png`)));
                await new Promise(resolve => setTimeout(resolve, 0));
                await new Promise(resolve => setTimeout(resolve, 0));
                expect(backend.peak).toBeLessThanOrEqual(8);
                expect(await backend.drain()).toBe(10);
                await all;
                expect(backend.peak).toBeLessThanOrEqual(8);
            });

            it("answers a refused and a missing file on their own, and the rest in full", async () => {
                const storage = createStorage(mockTransport);
                mockTransport.request.mockResolvedValueOnce({
                    data: {
                        "photos/mine.png": described,
                        "photos/theirs.png": { error: { code: "FORBIDDEN", message: "Not authorized for this object", status: 403 } },
                        "photos/gone.png": { error: { code: "NOT_FOUND", message: "File not found", status: 404 } }
                    }
                });

                const [mine, theirs, gone] = await Promise.allSettled(
                    ["photos/mine.png", "photos/theirs.png", "photos/gone.png"].map(key => storage.getSignedUrl(key)));

                expect(mine).toEqual({ status: "fulfilled", value: expect.objectContaining({ url: expect.stringContaining("token=t") }) });
                expect(theirs).toEqual({ status: "rejected", reason: expect.objectContaining({ status: 403, code: "FORBIDDEN" }) });
                expect(gone).toEqual({ status: "fulfilled", value: { url: null, fileNotFound: true } });
            });

            it("asks one file at a time, from then on, of a server without the batch route", async () => {
                const storage = createStorage(mockTransport);
                mockTransport.request.mockImplementation((async (path: string, init?: RequestInit) => {
                    if (init?.method === "POST") throw Object.assign(new Error("Not Found"), { status: 404 });
                    return { data: described };
                }) as unknown as typeof mockTransport.request);

                const first = await Promise.all(["a.png", "b.png", "c.png"].map(key => storage.getSignedUrl(key)));
                expect(first.every(config => config.url?.includes("token=t"))).toBe(true);
                await Promise.all(["d.png", "e.png"].map(key => storage.getSignedUrl(key)));

                const posts = mockTransport.request.mock.calls.filter(([, init]) => init?.method === "POST");
                const gets = mockTransport.request.mock.calls.filter(([, init]) => init?.method !== "POST");
                expect(posts).toHaveLength(1);
                expect(gets.map(([path]) => path)).toEqual([
                    "/storage/metadata/a.png", "/storage/metadata/b.png", "/storage/metadata/c.png",
                    "/storage/metadata/d.png", "/storage/metadata/e.png"
                ]);
            });

            it("forgets the least recently used URL past its cap, so a long session does not grow without bound", async () => {
                const storage = createStorage(mockTransport);
                mockTransport.request.mockResolvedValue({ data: { token: "t", tokenExpiresIn: 300 } });

                await storage.getSignedUrl("photos/first.png");
                for (let i = 0; i < 2_000; i++) await storage.getSignedUrl(`photos/${i}.png`);
                expect(mockTransport.request).toHaveBeenCalledTimes(2_001);

                // The most recent are still cached; the first was evicted.
                await storage.getSignedUrl("photos/1999.png");
                expect(mockTransport.request).toHaveBeenCalledTimes(2_001);
                await storage.getSignedUrl("photos/first.png");
                expect(mockTransport.request).toHaveBeenCalledTimes(2_002);
            });

            it("does not keep a failed lookup: the next call asks again", async () => {
                const storage = createStorage(mockTransport);
                const error = Object.assign(new Error("Server Error"), { status: 500 });
                mockTransport.request.mockRejectedValueOnce(error);
                await expect(storage.getSignedUrl("photos/flaky.png")).rejects.toThrow("Server Error");

                mockTransport.request.mockResolvedValueOnce({ data: { token: "t", tokenExpiresIn: 300 } });
                await expect(storage.getSignedUrl("photos/flaky.png")).resolves.toMatchObject({ url: expect.stringContaining("token=t") });
            });
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

            // A RebaseApiError with the status, like every other failure the
            // client reports — it was a plain Error with the status dropped.
            await expect(storage.getObject("error.txt")).rejects.toMatchObject({
                name: "RebaseApiError", status: 500, code: "INTERNAL_ERROR"
            });
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

        it("strips s3:// and the source's own bucket", async () => {
            const storage = createStorage(mockTransport);
            const mockBlob = new Blob(["x"]);

            mockTransport.fetchFn.mockResolvedValueOnce({
                ok: true,
                status: 200,
                blob: async () => mockBlob
            } as any);

            await storage.getObject("s3://bucket/file.dat");

            expect(mockTransport.fetchFn).toHaveBeenCalledWith(
                "http://localhost:3000/api/storage/file/file.dat?token=token",
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
    // A key under a folder named `default`
    // -----------------------------------------------------------------------
    describe("a key whose first folder is named `default`", () => {
        // The routes read one leading `default/` as the bucket, so the key
        // `default/photo.png` sent bare named the root `photo.png`. The
        // round trip through the real routes is
        // packages/server/test/storage-sdk-default-folder.test.ts.
        it("is sent behind the bucket segment, so the routes keep the folder", () => {
            expect(storageObjectPath("default/photo.png")).toBe("default/default/photo.png");
            expect(storageObjectPath("Default/photo.png")).toBe("default/Default/photo.png");
            expect(storageObjectPath("default/")).toBe("default/default/");
            expect(storageObjectPath("s3://bucket/default/photo.png")).toBe("default/default/photo.png");
        });

        it("reads and deletes by that path", async () => {
            const storage = createStorage(mockTransport);
            mockTransport.request.mockResolvedValueOnce({ data: { token: "tok" } });
            mockTransport.request.mockResolvedValueOnce({});

            const config = await storage.getSignedUrl("default/photo.png");
            await storage.deleteObject("default/photo.png");

            expect(mockTransport.request).toHaveBeenCalledWith("/storage/metadata/default/default/photo.png");
            expect(config.url).toBe("http://localhost:3000/api/storage/file/default/default/photo.png?token=tok");
            expect(mockTransport.request).toHaveBeenCalledWith("/storage/file/default/default/photo.png", { method: "DELETE" });
        });

        it("is not taken for public when its folder is `default/public`", async () => {
            const storage = createStorage(mockTransport);
            mockTransport.request.mockResolvedValueOnce({ data: { token: "tok" } });

            const config = await storage.getSignedUrl("default/public/report.pdf");

            expect(mockTransport.request).toHaveBeenCalledWith("/storage/metadata/default/default/public/report.pdf");
            expect(config.url).toContain("token=tok");
        });

        it("leaves every path that already named its object as it was", () => {
            expect(storageObjectPath("photo.png")).toBe("photo.png");
            expect(storageObjectPath("default")).toBe("default");
            expect(storageObjectPath("defaults/photo.png")).toBe("defaults/photo.png");
            expect(storageObjectPath("images/default/photo.png")).toBe("images/default/photo.png");
            // A storageUrl carries its bucket already.
            expect(storageObjectPath("local://default/photo.png")).toBe("default/photo.png");
            expect(storageObjectPath("local://default/default/photo.png")).toBe("default/default/photo.png");
            // So does a path given with its bucket.
            expect(storageObjectPath("photo.png", "default")).toBe("default/photo.png");
            expect(storageObjectPath("mybucket/file.jpg", "mybucket")).toBe("mybucket/file.jpg");
            // ...and only then: a key that merely begins with the bucket's name is not behind it.
            expect(storageObjectPath("mybucketfile.jpg", "mybucket")).toBe("mybucket/mybucketfile.jpg");
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
