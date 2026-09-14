import { describe, expect, it, beforeAll, afterAll } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Hono } from "hono";
import type { BackendBootstrapper, InitializedDriver } from "@rebasepro/types";

import { initializeRebaseBackend } from "../src/init";
import { RUNTIME_DEFAULT_MAX_BODY_SIZE } from "../src/deploy/pod-contract";
import { DEFAULT_MAX_FILE_SIZE } from "../src/storage/types";

/**
 * Which body limit an upload meets.
 *
 * Two limits cover `POST /api/storage/upload`: the global `maxBodySize` (10 MB
 * by default), registered on every path under the base path, and the storage
 * router's own, from `storage.maxFileSize` (50 MB by default). The docs said
 * the second overrides the first. It could not: both are Hono `bodyLimit`s,
 * the global one runs first, and a `bodyLimit` answers 413 on the
 * `Content-Length` alone. So every upload between 10 and 50 MB was refused
 * before the storage limit was consulted, and the admin panel uploads through
 * exactly this route.
 *
 * The app under test is the real one, booted through `initializeRebaseBackend`,
 * because the bug was in how init.ts wires the two limits together. A router
 * assembled by hand would pass whatever init.ts does.
 */

const MB = 1024 * 1024;

const bootstrapper = {
    type: "fake",
    isDefault: true,
    async initializeDriver(): Promise<InitializedDriver> {
        return { driver: {} as never, collections: [], internals: {} } as unknown as InitializedDriver;
    }
} as unknown as BackendBootstrapper;

/** Every request is a signed-in editor, as the admin panel's uploads are. */
const signedIn = {
    id: "signed-in",
    verifyRequest: async () => ({ uid: "editor-1", roles: ["editor"] }),
    getCapabilities: () => ({})
};

let tempDir: string;
/** Where the local controller put an upload: under the default bucket. */
const stored = (key: string) => path.join(tempDir, "default", key);
const originalNodeEnv = process.env.NODE_ENV;
const originalForce = process.env.FORCE_LOCAL_STORAGE;

beforeAll(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-upload-body-limit-"));
    process.env.NODE_ENV = "development";
    delete process.env.FORCE_LOCAL_STORAGE;
});

afterAll(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
    process.env.NODE_ENV = originalNodeEnv;
    if (originalForce === undefined) delete process.env.FORCE_LOCAL_STORAGE;
    else process.env.FORCE_LOCAL_STORAGE = originalForce;
});

/** Default limits unless a test names one: no `maxBodySize`, no `maxFileSize`. */
async function boot(storage: { maxFileSize?: number } = {}) {
    const app = new Hono();
    await initializeRebaseBackend({
        app: app as never,
        server: {} as never,
        collections: [],
        bootstrappers: [bootstrapper],
        auth: signedIn,
        storage: { type: "local", basePath: tempDir, ...storage }
    } as never);
    return app;
}

/**
 * A multipart upload, encoded up front so it carries a `Content-Length` the way
 * a browser's `FormData` upload does. That header is what the limit refused on.
 */
async function multipartUpload(size: number, key: string) {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(size)]), key);
    form.append("key", key);
    const encoded = new Response(form);
    const body = new Uint8Array(await encoded.arrayBuffer());
    return {
        method: "POST",
        body,
        headers: {
            "content-type": encoded.headers.get("content-type")!,
            "content-length": String(body.byteLength)
        }
    };
}

/** A raw body of `size` bytes that declares its length. */
function sized(method: string, size: number) {
    return {
        method,
        body: new Uint8Array(size),
        headers: { "content-length": String(size) }
    };
}

async function errorOf(res: Response) {
    return (await res.json() as { error: { code: string; message: string } }).error;
}

describe("POST /api/storage/upload uses the storage limit, not the global one", () => {
    it("accepts a 12 MB file with the default limits", async () => {
        const app = await boot();

        const res = await app.request("/api/storage/upload", await multipartUpload(12 * MB, "twelve.bin"));

        expect(res.status).toBe(201);
        expect(fs.statSync(stored("twelve.bin")).size).toBe(12 * MB);
    });

    it("accepts it streamed too, with no Content-Length", async () => {
        // The other branch of `bodyLimit`: it counts the stream as it is read
        // instead of trusting a header. The global counter tripped at 10 MB here
        // just the same.
        const app = await boot();
        const { body, headers } = await multipartUpload(12 * MB, "streamed.bin");
        const stream = new Blob([body]).stream();

        const res = await app.request("/api/storage/upload", {
            method: "POST",
            body: stream,
            headers: { "content-type": headers["content-type"] },
            duplex: "half"
        } as RequestInit);

        expect(res.status).toBe(201);
        expect(fs.statSync(stored("streamed.bin")).size).toBe(12 * MB);
    });

    it("still refuses a file over storage.maxFileSize, with the upload route's own error", async () => {
        // Skipping the global limit on this path must hand the path to the
        // storage limit, not leave it with none. A 20 MB ceiling sits above the
        // global 10 MB, so only the storage limit can produce this message.
        const app = await boot({ maxFileSize: 20 * MB });

        const under = await app.request("/api/storage/upload", await multipartUpload(15 * MB, "fifteen.bin"));
        const over = await app.request("/api/storage/upload", await multipartUpload(21 * MB, "twenty-one.bin"));

        expect(under.status).toBe(201);
        expect(over.status).toBe(413);
        const error = await errorOf(over);
        expect(error.code).toBe("PAYLOAD_TOO_LARGE");
        expect(error.message).toBe("File too large. Maximum upload size is 20MB.");
        expect(fs.existsSync(stored("twenty-one.bin"))).toBe(false);
    });

    it("meets a limit however the path is spelled", async () => {
        // The exemption and the route's own limit have to agree on what the
        // path is. If one read the path decoded and the other raw,
        // `/%75pload` would be exempt from the global limit and unmatched by
        // the upload one, and nothing would cap it.
        const app = await boot({ maxFileSize: 20 * MB });

        const res = await app.request("/api/storage/%75pload", await multipartUpload(21 * MB, "encoded.bin"));

        expect(res.status).toBe(413);
        expect(fs.existsSync(stored("encoded.bin"))).toBe(false);
    });
});

describe("every other route keeps the global limit", () => {
    const GLOBAL_MESSAGE = "Request body too large. Maximum size is 10MB.";

    it("refuses a 12 MB TUS chunk, as before", async () => {
        // TUS is unchanged on purpose: `PATCH /tus/:id` buffers its chunk in
        // memory, and the global limit is the only cap on a single chunk. A
        // chunk that got past it would reach the handler and answer 404 for
        // the unknown upload id instead.
        const app = await boot();

        const res = await app.request("/api/storage/tus/no-such-upload", sized("PATCH", 12 * MB));

        expect(res.status).toBe(413);
        expect((await errorOf(res)).message).toBe(GLOBAL_MESSAGE);
    });

    it("refuses a 12 MB body on another storage route", async () => {
        const app = await boot();

        const res = await app.request("/api/storage/folder", sized("POST", 12 * MB));

        expect(res.status).toBe(413);
        expect((await errorOf(res)).message).toBe(GLOBAL_MESSAGE);
    });

    it("refuses a path that only looks like the upload route", async () => {
        // The exemption is an exact path. A prefix would carry siblings with it.
        const app = await boot();

        const res = await app.request("/api/storage/upload-extra", sized("POST", 12 * MB));

        expect(res.status).toBe(413);
        expect((await errorOf(res)).message).toBe(GLOBAL_MESSAGE);
    });

    it("refuses a 12 MB body outside storage", async () => {
        const app = await boot();

        const res = await app.request("/api/anything", sized("POST", 12 * MB));

        expect(res.status).toBe(413);
        expect((await errorOf(res)).message).toBe(GLOBAL_MESSAGE);
    });
});

describe("the defaults are the ones the pod contract states", () => {
    // `pnpm check:chart` holds the Helm chart's ingress above these two
    // constants. That is only worth something if they are the limits the
    // runtime actually enforces, not a copy of them. Each limit is probed at
    // its edge by the declared length alone, which is what `bodyLimit` reads,
    // so no test here has to allocate 50 MB.
    const declaring = (method: string, length: number) => ({
        method,
        body: "x",
        headers: { "content-length": String(length) }
    });

    it("caps every route at RUNTIME_DEFAULT_MAX_BODY_SIZE", async () => {
        const app = await boot();

        const at = await app.request("/api/anything", declaring("POST", RUNTIME_DEFAULT_MAX_BODY_SIZE));
        const over = await app.request("/api/anything", declaring("POST", RUNTIME_DEFAULT_MAX_BODY_SIZE + 1));

        expect(at.status).not.toBe(413);
        expect(over.status).toBe(413);
    });

    it("caps the upload route at DEFAULT_MAX_FILE_SIZE", async () => {
        const app = await boot();

        const at = await app.request("/api/storage/upload", declaring("POST", DEFAULT_MAX_FILE_SIZE));
        const over = await app.request("/api/storage/upload", declaring("POST", DEFAULT_MAX_FILE_SIZE + 1));

        expect(at.status).not.toBe(413);
        expect(over.status).toBe(413);
        expect((await errorOf(over)).message).toMatch(/^File too large\./);
    });
});
