import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
/**
 * A property's `maxSize` and `acceptedFiles` hold for every upload into its
 * storage path — not only for an upload that names the property.
 *
 * The server checked a property's limits only when the request said which
 * property the file was for (`collection` + `property`). The panel never said,
 * and a direct caller simply leaves the fields out — so the rule the docs call
 * "enforced by the server" was enforced for nobody. A property's `storagePath`
 * is where its files go; it is now also the server-side rule that carries its
 * limits, whichever door the upload comes through.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Hono } from "hono";
import type { CollectionConfig } from "@rebasepro/types";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { LocalStorageController } from "../src/storage/LocalStorageController";
import { DefaultStorageRegistry } from "../src/storage/storage-registry";
import { createStorageRoutes } from "../src/storage/routes";
import {
    createUploadConstraintResolver,
    createUploadPathResolver
} from "../src/storage/property-limits";

const posts: CollectionConfig = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        id: { type: "number", isId: "increment" },
        cover: {
            type: "string",
            storage: { storagePath: "covers", maxSize: 1024, acceptedFiles: ["image/*"] }
        },
        avatar: {
            type: "string",
            storage: { storagePath: "users/{entityId}/avatar", acceptedFiles: ["image/*"] }
        },
        gallery: {
            type: "array",
            of: { type: "string", storage: { storagePath: "shared", acceptedFiles: ["image/*"] } }
        },
        attachment: {
            type: "string",
            storage: { storagePath: "shared", acceptedFiles: [".pdf"] }
        },
        logo: {
            type: "string",
            storage: { storagePath: "logos", public: true, acceptedFiles: ["image/*"] }
        },
        clip: {
            type: "string",
            storage: { storagePath: "clips", storageSource: "media", acceptedFiles: ["video/*"] }
        },
        nested: {
            type: "map",
            properties: {
                scan: { type: "string", storage: { storagePath: "{path}/scans", acceptedFiles: [".pdf"] } }
            }
        },
        computed: {
            type: "string",
            storage: { storagePath: () => "computed", acceptedFiles: ["image/*"] }
        },
        loose: { type: "string", storage: { storagePath: "loose" } }
    }
};

describe("createUploadPathResolver", () => {
    const rules = createUploadPathResolver([posts]);
    const sources = (storageId: string, key: string) => rules(storageId, key).map(c => c.source).sort();

    it("matches a file directly under a property's storage path", () => {
        expect(sources("(default)", "covers/abc_a.png")).toEqual(["posts.cover"]);
    });

    it("does not match the path itself, a deeper key, or a sibling", () => {
        expect(sources("(default)", "covers")).toEqual([]);
        expect(sources("(default)", "covers/x/a.png")).toEqual([]);
        expect(sources("(default)", "coversheet/a.png")).toEqual([]);
    });

    it("reads a placeholder as one segment, and {path} as any number", () => {
        expect(sources("(default)", "users/42/avatar/a.png")).toEqual(["posts.avatar"]);
        expect(sources("(default)", "users/42/other/a.png")).toEqual([]);
        expect(sources("(default)", "posts/7/comments/scans/a.pdf")).toEqual(["posts.nested.scan"]);
    });

    it("returns every property sharing a path", () => {
        expect(sources("(default)", "shared/a.pdf")).toEqual(["posts.attachment", "posts.gallery"]);
    });

    it("puts a public property's rule under the public prefix", () => {
        expect(sources("(default)", "public/logos/a.png")).toEqual(["posts.logo"]);
        expect(sources("(default)", "logos/a.png")).toEqual([]);
    });

    it("applies a property's rule on its own storage source only", () => {
        expect(sources("media", "clips/a.mp4")).toEqual(["posts.clip"]);
        expect(sources("(default)", "clips/a.mp4")).toEqual([]);
        expect(sources("media", "covers/a.png")).toEqual([]);
    });

    it("has no rule for a storage path computed by a function, or a property with no limits", () => {
        expect(sources("(default)", "computed/a.exe")).toEqual([]);
        expect(sources("(default)", "loose/a.exe")).toEqual([]);
    });
});

describe("every upload door holds a file to the rule of the path it lands in", () => {
    let app: Hono<HonoEnv>;
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-storage-path-limits-"));
        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({
            registry: DefaultStorageRegistry.create({
                "(default)": new LocalStorageController({ type: "local", basePath: path.join(root, "a") }),
                media: new LocalStorageController({ type: "local", basePath: path.join(root, "b") })
            }),
            requireAuth: false,
            uploadConstraints: createUploadConstraintResolver([posts]),
            uploadPathConstraints: createUploadPathResolver([posts])
        }));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    const upload = (key: string, body: Blob, extra: Record<string, string> = {}) => {
        const form = new FormData();
        form.append("file", body, key.split("/").pop()!);
        form.append("key", key);
        for (const [k, v] of Object.entries(extra)) form.append(k, v);
        return app.request("/api/storage/upload", { method: "POST", body: form });
    };
    const exe = () => new Blob(["MZ"], { type: "application/x-msdownload" });
    const png = (size = 10) => new Blob(["x".repeat(size)], { type: "image/png" });

    it("refuses a file a property would not accept, with no property named", async () => {
        const refused = await upload("covers/abc_payload.exe", exe());
        expect(refused.status).toBe(400);
        expect(await refused.json()).toMatchObject({ error: { code: "STORAGE_FILE_TYPE_REFUSED" } });

        const tooBig = await upload("covers/abc_big.png", png(2048));
        expect(tooBig.status).toBe(413);
        expect(await tooBig.json()).toMatchObject({ error: { code: "STORAGE_FILE_TOO_LARGE" } });

        expect((await upload("covers/abc_ok.png", png())).status).toBe(201);
    });

    it("leaves a path no property claims to the global cap", async () => {
        expect((await upload("elsewhere/payload.exe", exe())).status).toBe(201);
    });

    it("accepts a file any of the properties sharing a path would take", async () => {
        expect((await upload("shared/a.pdf", new Blob(["%PDF"], { type: "application/pdf" }))).status).toBe(201);
        expect((await upload("shared/a.png", png())).status).toBe(201);
        expect((await upload("shared/a.exe", exe())).status).toBe(400);
    });

    it("is not widened by naming a looser property", async () => {
        // `loose` declares no limits. Naming it must not unlock the cover path.
        const res = await upload("covers/abc_payload.exe", exe(), { collection: "posts", property: "loose" });
        expect(res.status).toBe(400);
    });

    it("holds a named source's property to its source", async () => {
        const toMedia = await upload("clips/a.exe", exe(), { storageId: "media" });
        expect(toMedia.status).toBe(400);
        // The same key on the default source is not the clip property's path.
        expect((await upload("clips/a.exe", exe())).status).toBe(201);
    });

    it("refuses the resumable upload at creation, before the first chunk", async () => {
        const b64 = (s: string) => Buffer.from(s).toString("base64");
        const create = (key: string, type: string) => app.request("/api/storage/tus", {
            method: "POST",
            headers: {
                "Tus-Resumable": "1.0.0",
                "Upload-Length": "10",
                "Upload-Metadata": `key ${b64(key)},filetype ${b64(type)}`
            }
        });

        expect((await create("covers/abc_payload.exe", "application/x-msdownload")).status).toBe(400);
        expect((await create("covers/abc_ok.png", "image/png")).status).toBe(201);
    });
});

describe("a booted backend", () => {
    it("holds uploads to the storage paths of the collections it serves", async () => {
        const { initializeRebaseBackend } = await import("../src/init");
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-storage-path-limits-boot-"));
        const originalNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = "development";
        try {
            const app = new Hono();
            await initializeRebaseBackend({
                app: app as never,
                server: {} as never,
                collections: [posts],
                bootstrappers: [{
                    type: "fake",
                    isDefault: true,
                    async initializeDriver() {
                        return { driver: {} as never, collections: [], internals: {} };
                    }
                }],
                auth: {
                    id: "signed-in",
                    verifyRequest: async () => ({ uid: "editor-1", roles: ["editor"] }),
                    getCapabilities: () => ({})
                },
                storage: { type: "local", basePath: root }
            } as never);

            const form = new FormData();
            form.append("file", new Blob(["MZ"], { type: "application/x-msdownload" }), "payload.exe");
            form.append("key", "covers/abc_payload.exe");
            const res = await app.request("/api/storage/upload", { method: "POST", body: form });

            expect(res.status).toBe(400);
            expect(await res.json()).toMatchObject({ error: { code: "STORAGE_FILE_TYPE_REFUSED" } });
        } finally {
            process.env.NODE_ENV = originalNodeEnv;
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
