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
});
