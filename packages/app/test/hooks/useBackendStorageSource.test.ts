import { renderHook } from "@testing-library/react";
import { useBackendStorageSource } from "../../src/hooks/useBackendStorageSource";

/**
 * The hook built file URLs as `/storage/file/<key>?token=<session JWT>` and
 * fetched `/storage/file/*` with the session JWT as a Bearer. The server's
 * `fileTokenAuth` refuses a full access JWT in both places — only the
 * short-lived, path-scoped token `/metadata` mints is accepted there — so every
 * private file 401'd and `getObject` always threw. The session JWT also ended
 * up in `<img src>` attributes and access logs, and keys were sent unencoded.
 */

const ACCESS_JWT = "session-access-jwt";
const API = "https://api.example.com";

type Call = { url: string; init?: RequestInit };

/** The parts of a `Response` the hook reads; jsdom has no `Response`. */
function reply(status: number, body: { json?: unknown; blob?: Blob }) {
    return {
        status,
        ok: status >= 200 && status < 300,
        json: async () => body.json,
        blob: async () => body.blob ?? new Blob([])
    };
}

function mockBackend(metadata: Record<string, unknown>) {
    const calls: Call[] = [];
    Object.defineProperty(global, "fetch", {
        configurable: true,
        writable: true,
        value: async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            calls.push({ url, init });
            if (url.includes("/storage/metadata/")) return reply(200, { json: { data: metadata } });
            if (url.includes("/storage/file/")) return reply(200, { blob: new Blob(["bytes"], { type: "image/png" }) });
            return reply(404, { json: {} });
        }
    });
    return calls;
}

function storage() {
    return renderHook(() => useBackendStorageSource({
        apiUrl: API,
        getAuthToken: async () => ACCESS_JWT
    })).result.current;
}

describe("useBackendStorageSource", () => {
    const realFetch = global.fetch;
    afterEach(() => {
        Object.defineProperty(global, "fetch", { configurable: true, writable: true, value: realFetch });
        jest.useRealTimers();
    });

    it("signs a private file URL with the scoped download token, never the session JWT", async () => {
        mockBackend({ fullPath: "default/photos/cat.png", token: "scoped-token", tokenExpiresIn: 300 });

        const { url } = await storage().getSignedUrl("photos/cat.png");

        expect(url).toBe(`${API}/api/storage/file/photos/cat.png?token=scoped-token`);
        expect(url).not.toContain(ACCESS_JWT);
    });

    it("encodes each segment of the key", async () => {
        const calls = mockBackend({ token: "scoped-token", tokenExpiresIn: 300 });

        const { url } = await storage().getSignedUrl("reports/100% done #2.pdf");

        expect(calls[0].url).toBe(`${API}/api/storage/metadata/reports/100%25%20done%20%232.pdf`);
        expect(url).toBe(`${API}/api/storage/file/reports/100%25%20done%20%232.pdf?token=scoped-token`);
    });

    it("gives a public file a token-less URL", async () => {
        mockBackend({ public: true });

        const { url } = await storage().getSignedUrl("public/logo.png");

        expect(url).toBe(`${API}/api/storage/file/public/logo.png`);
    });

    it("downloads through the scoped URL, with no session JWT on the file route", async () => {
        const calls = mockBackend({ token: "scoped-token", tokenExpiresIn: 300 });

        const file = await storage().getObject("photos/cat.png");

        const download = calls.find(c => c.url.includes("/storage/file/"))!;
        expect(download.url).toBe(`${API}/api/storage/file/photos/cat.png?token=scoped-token`);
        expect(JSON.stringify(download.init ?? {})).not.toContain(ACCESS_JWT);
        expect(file?.name).toBe("cat.png");
    });

    /**
     * The routes read one leading `default/` of a path as the bucket, so the
     * key `default/photo.png` sent bare named the root `photo.png`: its
     * preview showed the root file and its delete deleted it. The rule is the
     * SDK's `storageObjectPath`, from `@rebasepro/types`, and its round trip
     * through the real routes is packages/server/test/storage-sdk-default-folder.test.ts.
     */
    describe("a key whose first folder is named `default`", () => {
        it("is read by its own path, not the root file's", async () => {
            const calls = mockBackend({ token: "scoped-token", tokenExpiresIn: 300 });

            const { url } = await storage().getSignedUrl("default/photo.png");

            expect(calls[0].url).toBe(`${API}/api/storage/metadata/default/default/photo.png`);
            expect(url).toBe(`${API}/api/storage/file/default/default/photo.png?token=scoped-token`);
        });

        it("is deleted by its own path, not the root file's", async () => {
            const calls = mockBackend({});

            await storage().deleteObject("default/photo.png");

            expect(calls).toHaveLength(1);
            expect(calls[0].url).toBe(`${API}/api/storage/file/default/default/photo.png`);
            expect(calls[0].init?.method).toBe("DELETE");
        });

        it("is not taken for public when its folder is `default/public`", async () => {
            const calls = mockBackend({ token: "scoped-token", tokenExpiresIn: 300 });

            const { url } = await storage().getSignedUrl("default/public/report.pdf");

            expect(calls[0].url).toBe(`${API}/api/storage/metadata/default/default/public/report.pdf`);
            expect(url).toContain("token=scoped-token");
        });
    });

    it("prefixes a bucket to a key that only begins with the bucket's name", async () => {
        const calls = mockBackend({ token: "scoped-token", tokenExpiresIn: 300 });

        await storage().getSignedUrl("defaults/photo.png", "default");

        expect(calls[0].url).toBe(`${API}/api/storage/metadata/default/defaults/photo.png`);
    });

    it("reads a storageUrl on S3 by its key, as the SDK does", async () => {
        const calls = mockBackend({ token: "scoped-token", tokenExpiresIn: 300 });

        await storage().getSignedUrl("s3://acme-media/products/a.png");

        expect(calls[0].url).toBe(`${API}/api/storage/metadata/products/a.png`);
    });

    it("asks for a new token once the old one has expired", async () => {
        jest.useFakeTimers({ now: 1_000_000 });
        const calls = mockBackend({ token: "scoped-token", tokenExpiresIn: 300 });
        const source = storage();

        await source.getSignedUrl("photos/cat.png");
        await source.getSignedUrl("photos/cat.png");
        expect(calls.filter(c => c.url.includes("/metadata/"))).toHaveLength(1);

        jest.setSystemTime(1_000_000 + 300_000);
        await source.getSignedUrl("photos/cat.png");
        expect(calls.filter(c => c.url.includes("/metadata/"))).toHaveLength(2);
    });

    // A collection view mounts one preview per row in the same tick, and rows
    // share files; each `/metadata` call spends the user's rate-limit budget.
    describe("many previews at once", () => {
        /**
         * A backend whose metadata requests stay open until drained. A batched
         * `POST /storage/metadata` is answered per key, as the server answers it.
         */
        function slowBackend() {
            const open: (() => void)[] = [];
            let metadataCalls = 0;
            const batches: string[][] = [];
            let inFlight = 0;
            let peak = 0;
            const described = { token: "scoped-token", tokenExpiresIn: 300 };
            Object.defineProperty(global, "fetch", {
                configurable: true,
                writable: true,
                value: (input: RequestInfo | URL, init?: RequestInit) => new Promise(resolve => {
                    const keys = init?.method === "POST" ? (JSON.parse(String(init.body)) as { keys: string[] }).keys : undefined;
                    if (keys) batches.push(keys);
                    metadataCalls += String(input).includes("/storage/metadata") ? 1 : 0;
                    inFlight++;
                    peak = Math.max(peak, inFlight);
                    open.push(() => {
                        inFlight--;
                        resolve(reply(200, { json: { data: keys ? Object.fromEntries(keys.map(key => [key, described])) : described } }));
                    });
                })
            });
            return {
                get metadataCalls() { return metadataCalls; },
                get batches() { return batches; },
                get peak() { return peak; },
                async drain() {
                    while (open.length) {
                        open.splice(0).forEach(answer => answer());
                        await new Promise(resolve => setTimeout(resolve, 0));
                    }
                }
            };
        }

        it("asks once for a file that 50 previews ask for together", async () => {
            const backend = slowBackend();
            const source = storage();

            const all = Promise.all(Array.from({ length: 50 }, () => source.getSignedUrl("photos/cat.png")));
            await new Promise(resolve => setTimeout(resolve, 0));
            await backend.drain();
            await all;

            expect(backend.metadataCalls).toBe(1);
        });

        it("asks for 100 different files together in one request, each with its own token", async () => {
            const backend = slowBackend();
            const source = storage();

            const all = Promise.all(Array.from({ length: 100 }, (_, i) => source.getSignedUrl(`photos/${i}.png`)));
            await new Promise(resolve => setTimeout(resolve, 0));
            await backend.drain();
            const configs = await all;

            expect(backend.metadataCalls).toBe(1);
            expect(backend.batches.map(keys => keys.length)).toEqual([100]);
            expect(configs[42].url).toBe(`${API}/api/storage/file/photos/42.png?token=scoped-token`);
        });

        it("keeps a bounded number of metadata requests open at once", async () => {
            const backend = slowBackend();
            const source = storage();

            // 1,000 files: ten batches of a hundred, at most eight open at once.
            const all = Promise.all(Array.from({ length: 1_000 }, (_, i) => source.getSignedUrl(`photos/${i}.png`)));
            await new Promise(resolve => setTimeout(resolve, 0));
            await backend.drain();
            await all;

            expect(backend.metadataCalls).toBe(10);
            expect(backend.peak).toBeLessThanOrEqual(8);
        });

        it("asks one file at a time, from then on, of a server without the batch route", async () => {
            const calls: Call[] = [];
            Object.defineProperty(global, "fetch", {
                configurable: true,
                writable: true,
                value: async (input: RequestInfo | URL, init?: RequestInit) => {
                    calls.push({ url: String(input), init });
                    if (init?.method === "POST") return reply(404, { json: {} });
                    return reply(200, { json: { data: { token: "scoped-token", tokenExpiresIn: 300 } } });
                }
            });
            const source = storage();

            const configs = await Promise.all(["a.png", "b.png", "c.png"].map(key => source.getSignedUrl(key)));
            expect(configs.map(config => config.url)).toEqual(["a", "b", "c"].map(name => `${API}/api/storage/file/${name}.png?token=scoped-token`));
            await Promise.all(["d.png", "e.png"].map(key => source.getSignedUrl(key)));

            expect(calls.filter(call => call.init?.method === "POST")).toHaveLength(1);
            expect(calls.filter(call => call.init?.method !== "POST").map(call => call.url)).toEqual(
                ["a", "b", "c", "d", "e"].map(name => `${API}/api/storage/metadata/${name}.png`));
        });

        it("answers a refused and a missing file on their own, and the rest in full", async () => {
            Object.defineProperty(global, "fetch", {
                configurable: true,
                writable: true,
                value: async () => reply(200, {
                    json: {
                        data: {
                            "photos/mine.png": { token: "scoped-token", tokenExpiresIn: 300 },
                            "photos/theirs.png": { error: { code: "FORBIDDEN", message: "Not authorized for this object", status: 403 } },
                            "photos/gone.png": { error: { code: "NOT_FOUND", message: "File not found", status: 404 } }
                        }
                    }
                })
            });
            const source = storage();

            const [mine, theirs, gone] = await Promise.allSettled(
                ["photos/mine.png", "photos/theirs.png", "photos/gone.png"].map(key => source.getSignedUrl(key)));

            expect(mine).toEqual({ status: "fulfilled", value: expect.objectContaining({ url: expect.stringContaining("token=scoped-token") }) });
            expect(theirs).toEqual({ status: "rejected", reason: expect.objectContaining({ message: "Not authorized for this object" }) });
            expect(gone).toEqual({ status: "fulfilled", value: { url: null, fileNotFound: true } });
        });
    });

    /**
     * A file over 8 MiB goes up through the resumable (TUS) endpoint, a chunk
     * per request, rather than as one multipart body the server parses whole.
     */
    describe("a large upload", () => {
        const MiB = 1024 * 1024;
        const RESULT = { key: "videos/clip.mp4", bucket: "default", storageUrl: "local://default/videos/clip.mp4" };

        /** A TUS endpoint in memory; `lost` answers every PATCH 404, as another instance would. */
        function tusBackend(options: { lost?: boolean } = {}) {
            const calls: Call[] = [];
            let length = 0;
            let received = 0;
            let metadata = "";
            const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? null });
            Object.defineProperty(global, "fetch", {
                configurable: true,
                writable: true,
                value: async (input: RequestInfo | URL, init?: RequestInit) => {
                    const url = String(input);
                    calls.push({ url, init });
                    const sent = (init?.headers ?? {}) as Record<string, string>;
                    if (url.endsWith("/storage/tus") && init?.method === "POST") {
                        length = Number(sent["Upload-Length"]);
                        metadata = sent["Upload-Metadata"];
                        return { status: 201, ok: true, headers: headers({ Location: "/api/storage/tus/0f0e0d0c-0b0a-4908-8706-050403020100", "Rebase-Upload-Result": "on-complete" }), json: async () => ({}) };
                    }
                    if (url.includes("/storage/tus/") && init?.method === "PATCH") {
                        if (options.lost) return { status: 404, ok: false, headers: headers({}), json: async () => ({ error: { message: "Upload not found" } }) };
                        received += (init.body as Blob).size;
                        return {
                            status: 204,
                            ok: true,
                            headers: headers({
                                "Upload-Offset": String(received),
                                ...(received >= length ? { "Rebase-Upload-Result": encodeURIComponent(JSON.stringify(RESULT)) } : {})
                            }),
                            json: async () => ({})
                        };
                    }
                    if (url.endsWith("/storage/upload")) return { ...reply(201, { json: { data: { ...RESULT, storageUrl: "via-multipart" } } }), headers: headers({}) };
                    return { ...reply(404, { json: {} }), headers: headers({}) };
                }
            });
            return { calls, get metadata() { return metadata; }, get received() { return received; } };
        }

        const largeFile = () => new File([new Uint8Array(9 * MiB)], "clip.mp4", { type: "video/mp4" });

        it("sends it a chunk per request, with the session token, and answers what was stored", async () => {
            const backend = tusBackend();
            const source = storage();

            const result = await source.putObject({ file: largeFile(), key: "videos/clip.mp4", metadata: { caption: "hi" } });

            expect(result).toEqual(RESULT);
            expect(backend.calls.map(c => `${c.init?.method} ${c.url.replace(API, "")}`)).toEqual([
                "POST /api/storage/tus",
                "PATCH /api/storage/tus/0f0e0d0c-0b0a-4908-8706-050403020100",
                "PATCH /api/storage/tus/0f0e0d0c-0b0a-4908-8706-050403020100"
            ]);
            expect(backend.received).toBe(9 * MiB);
            expect(backend.calls.every(c => (c.init?.headers as Record<string, string>).Authorization === `Bearer ${ACCESS_JWT}`)).toBe(true);
            const decoded = Object.fromEntries(backend.metadata.split(",").map(pair => [pair.split(" ")[0], atob(pair.split(" ")[1])]));
            expect(decoded).toEqual({ key: "videos/clip.mp4", metadata_caption: "hi", filename: "clip.mp4", filetype: "video/mp4" });
        });

        it("keeps a small file on the multipart route", async () => {
            const backend = tusBackend();
            await storage().putObject({ file: new File(["small"], "a.txt", { type: "text/plain" }), key: "a.txt" });
            expect(backend.calls.map(c => c.url.replace(API, ""))).toEqual(["/api/storage/upload"]);
        });

        it("falls back to the multipart route when the upload is lost to another instance, and stays there", async () => {
            const backend = tusBackend({ lost: true });
            const source = storage();

            expect(await source.putObject({ file: largeFile(), key: "videos/clip.mp4" })).toMatchObject({ storageUrl: "via-multipart" });
            await source.putObject({ file: largeFile(), key: "videos/second.mp4" });

            expect(backend.calls.map(c => c.url.replace(API, ""))).toEqual([
                "/api/storage/tus",
                "/api/storage/tus/0f0e0d0c-0b0a-4908-8706-050403020100",
                "/api/storage/upload",
                "/api/storage/upload"
            ]);
        });
    });

    /**
     * A private file's URL carries a download token minted for whoever asked.
     * The hook knows the user only through `getAuthToken`, so the credential is
     * what owns the cache: another user signing in — or a sign-out — in the
     * same tab must not be handed the URL minted for the one before.
     */
    describe("after a change of user", () => {
        function mintingBackend() {
            const asked: string[] = [];
            Object.defineProperty(global, "fetch", {
                configurable: true,
                writable: true,
                value: async (input: RequestInfo | URL, init?: RequestInit) => {
                    const bearer = new Headers(init?.headers).get("Authorization")?.replace(/^Bearer /, "") ?? "";
                    asked.push(bearer);
                    return reply(200, { json: { data: { token: `download-for-${bearer}`, tokenExpiresIn: 300 } } });
                }
            });
            return asked;
        }

        it("asks again as the new user instead of reusing the previous user's URL", async () => {
            const asked = mintingBackend();
            let token = "token-alice";
            const source = renderHook(() => useBackendStorageSource({
                apiUrl: API,
                getAuthToken: async () => token
            })).result.current;

            await expect(source.getSignedUrl("private/report.pdf")).resolves.toMatchObject({ url: expect.stringContaining("download-for-token-alice") });
            await source.getSignedUrl("private/report.pdf");
            expect(asked).toEqual(["token-alice"]);

            token = "token-bob";
            await expect(source.getSignedUrl("private/report.pdf")).resolves.toMatchObject({ url: expect.stringContaining("download-for-token-bob") });
            expect(asked).toEqual(["token-alice", "token-bob"]);
        });

        it("does not ask for a token to serve a public file", async () => {
            const asked = mintingBackend();
            const getAuthToken = jest.fn(async (): Promise<string> => { throw new Error("signed out"); });
            const source = renderHook(() => useBackendStorageSource({ apiUrl: API, getAuthToken })).result.current;

            await expect(source.getSignedUrl("public/logo.png")).resolves.toMatchObject({ url: `${API}/api/storage/file/public/logo.png` });
            expect(asked).toEqual([]);
            expect(getAuthToken).not.toHaveBeenCalled();
        });
    });
});

describe("useBackendStorageSource — a refused request", () => {
    /**
     * The server answers `{ error: { message, code } }`. The hook read
     * `body.error` as the message, so every refusal surfaced as
     * "[object Object]".
     */
    it("says what the server said", async () => {
        Object.defineProperty(global, "fetch", {
            configurable: true,
            writable: true,
            value: async () => reply(403, { json: { error: { message: "Not authorized for this object", code: "FORBIDDEN" } } })
        });
        const source = storage();

        await expect(source.putObject({ file: new File(["x"], "x.txt"), key: "x.txt" }))
            .rejects.toThrow("Not authorized for this object");
        await expect(source.deleteObject("x.txt")).rejects.toThrow("Not authorized for this object");
        await expect(source.listObjects("")).rejects.toMatchObject({ message: "Not authorized for this object", status: 403 });
    });
});
