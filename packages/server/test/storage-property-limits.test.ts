import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Hono } from "hono";
import type { CollectionConfig } from "@rebasepro/types";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { LocalStorageController } from "../src/storage/LocalStorageController";
import { createStorageRoutes } from "../src/storage/routes";
import {
    createUploadConstraintResolver,
    isAcceptedFile,
    readUploadPropertyContext
} from "../src/storage/property-limits";

/**
 * `storage.maxSize` and `storage.acceptedFiles` were declared per property,
 * published in the generated types, rendered by the panel's file picker — and
 * enforced by the browser and nothing else. `curl -F file=@payload.exe` past
 * the picker put a 40 MB executable in a bucket whose config said "images,
 * under 200 KB".
 */
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
        attachment: {
            type: "string",
            storage: { storagePath: "docs", acceptedFiles: [".pdf"] }
        },
        gallery: {
            type: "array",
            of: { type: "string", storage: { storagePath: "gallery", maxSize: 512 } }
        },
        meta: {
            type: "map",
            properties: {
                avatar: { type: "string", storage: { storagePath: "avatars", maxSize: 256 } }
            }
        },
        // A storage property that declares no limits at all.
        loose: { type: "string", storage: { storagePath: "loose" } },
        title: { type: "string" }
    }
};

describe("createUploadConstraintResolver", () => {
    const resolve = createUploadConstraintResolver([posts]);

    it("finds a top-level storage property", () => {
        expect(resolve("posts", "cover")).toEqual({
            maxSize: 1024,
            acceptedFiles: ["image/*"],
            source: "posts.cover"
        });
    });

    it("descends into a map", () => {
        expect(resolve("posts", "meta.avatar")?.maxSize).toBe(256);
    });

    it("reads the element type of an array of files", () => {
        // The file being uploaded is an *element*, so the `of` is what carries
        // the storage block.
        expect(resolve("posts", "gallery")?.maxSize).toBe(512);
        expect(resolve("posts", "gallery.2")?.maxSize).toBe(512);
    });

    it("says nothing for a property that declares no limits", () => {
        expect(resolve("posts", "loose")).toBeUndefined();
        expect(resolve("posts", "title")).toBeUndefined();
    });

    it("says nothing for an unknown collection or property", () => {
        expect(resolve("nope", "cover")).toBeUndefined();
        expect(resolve("posts", "nope")).toBeUndefined();
    });
});

describe("isAcceptedFile", () => {
    it("accepts everything when nothing is declared", () => {
        expect(isAcceptedFile(undefined, "application/x-msdownload", "a.exe")).toBe(true);
        expect(isAcceptedFile([], "application/x-msdownload", "a.exe")).toBe(true);
    });

    it("matches a wildcard over a type", () => {
        expect(isAcceptedFile(["image/*"], "image/png", "a.png")).toBe(true);
        expect(isAcceptedFile(["image/*"], "application/pdf", "a.pdf")).toBe(false);
    });

    it("matches an exact type, ignoring parameters", () => {
        expect(isAcceptedFile(["text/csv"], "text/csv; charset=utf-8", "a.csv")).toBe(true);
    });

    it("matches an extension, which is what <input accept> takes", () => {
        // A browser that sends `application/octet-stream` for a `.pdf` is why
        // extension entries exist at all.
        expect(isAcceptedFile([".pdf"], "application/octet-stream", "report.pdf")).toBe(true);
        expect(isAcceptedFile([".pdf"], "application/octet-stream", "report.exe")).toBe(false);
    });

    it("refuses a file with no content type when a type is required", () => {
        expect(isAcceptedFile(["image/*"], undefined, "a.png")).toBe(false);
    });
});

describe("readUploadPropertyContext", () => {
    it("reads both fields or nothing", () => {
        expect(readUploadPropertyContext({ collection: "posts", property: "cover" }))
            .toEqual({ collection: "posts", property: "cover" });
        expect(readUploadPropertyContext({ collection: "posts" })).toBeUndefined();
        expect(readUploadPropertyContext({ collection: "  ", property: "cover" })).toBeUndefined();
        expect(readUploadPropertyContext(undefined)).toBeUndefined();
    });
});

describe("POST /upload enforces the destination property's limits", () => {
    let app: Hono<HonoEnv>;
    let tempDir: string;

    const upload = async (
        file: Blob,
        fileName: string,
        context?: { collection: string; property: string }
    ) => {
        const form = new FormData();
        form.append("file", file, fileName);
        form.append("key", fileName);
        if (context) {
            form.append("collection", context.collection);
            form.append("property", context.property);
        }
        return app.fetch(new Request("http://localhost/api/storage/upload", { method: "POST", body: form }));
    };

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-storage-limits-"));
        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({
            controller: new LocalStorageController({ basePath: tempDir }),
            requireAuth: false,
            uploadConstraints: createUploadConstraintResolver([posts])
        }));
    });

    afterEach(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    it("refuses a file over the property's maxSize with a 413 naming the property", async () => {
        const res = await upload(new Blob(["x".repeat(2048)], { type: "image/png" }), "big.png", {
            collection: "posts",
            property: "cover"
        });
        expect(res.status).toBe(413);
        const body = await res.json() as { error: { code: string; message: string; details?: { property?: string; maxSize?: number } } };
        expect(body.error.code).toBe("STORAGE_FILE_TOO_LARGE");
        expect(body.error.message).toContain("posts.cover");
        expect(body.error.details?.maxSize).toBe(1024);
    });

    it("refuses a file the property does not accept with a 400", async () => {
        const res = await upload(new Blob(["x"], { type: "application/x-msdownload" }), "payload.exe", {
            collection: "posts",
            property: "cover"
        });
        expect(res.status).toBe(400);
        const body = await res.json() as { error: { code: string; message: string } };
        expect(body.error.code).toBe("STORAGE_FILE_TYPE_REFUSED");
        expect(body.error.message).toContain("posts.cover");
    });

    it("accepts a file that satisfies both", async () => {
        const res = await upload(new Blob(["x".repeat(100)], { type: "image/png" }), "small.png", {
            collection: "posts",
            property: "cover"
        });
        expect(res.status).toBe(201);
    });

    it("enforces an array property's element limits", async () => {
        const res = await upload(new Blob(["x".repeat(1000)], { type: "image/png" }), "g.png", {
            collection: "posts",
            property: "gallery"
        });
        expect(res.status).toBe(413);
    });

    it("enforces a nested map property's limits", async () => {
        const res = await upload(new Blob(["x".repeat(1000)], { type: "image/png" }), "a.png", {
            collection: "posts",
            property: "meta.avatar"
        });
        expect(res.status).toBe(413);
    });

    it("falls back to the global cap when the request names no property", async () => {
        // An upload that names no property has no property limit to check, and
        // refusing every context-less upload would break every existing client.
        const res = await upload(new Blob(["x".repeat(4096)], { type: "application/x-msdownload" }), "anything.exe");
        expect(res.status).toBe(201);
    });

    it("falls back when the named property declares no limits", async () => {
        const res = await upload(new Blob(["x".repeat(4096)], { type: "application/x-msdownload" }), "l.exe", {
            collection: "posts",
            property: "loose"
        });
        expect(res.status).toBe(201);
    });

    it("cannot be widened by naming an unknown property", async () => {
        // Naming a property can make an upload stricter or leave it at the
        // global cap; it can never widen anything, because the rules come from
        // the server's registry and not from the request.
        const res = await upload(new Blob(["x".repeat(2048)], { type: "image/png" }), "big.png", {
            collection: "posts",
            property: "cover"
        });
        expect(res.status).toBe(413);
        const widened = await upload(new Blob(["x".repeat(2048)], { type: "image/png" }), "big2.png", {
            collection: "posts",
            property: "does-not-exist"
        });
        // Unknown property → no property rule → the global cap, which this file
        // is under. The caller gained nothing they did not already have by
        // omitting the context entirely.
        expect(widened.status).toBe(201);
    });
});

/**
 * TUS is a second way to write an object. A limit enforced on `POST /upload`
 * alone leaves the resumable route as the way around it — which is exactly how
 * the *global* cap came to be missing from this path in the first place.
 */
describe("POST /tus enforces the same limits, before the first chunk", () => {
    let app: Hono<HonoEnv>;
    let tempDir: string;

    /** `Upload-Metadata` is a comma-separated list of `key <base64>` pairs. */
    const metadata = (entries: Record<string, string>): string =>
        Object.entries(entries)
            .map(([key, value]) => `${key} ${Buffer.from(value, "utf-8").toString("base64")}`)
            .join(",");

    const create = (length: number, entries: Record<string, string>) =>
        app.fetch(new Request("http://localhost/api/storage/tus", {
            method: "POST",
            headers: {
                "Upload-Length": String(length),
                "Upload-Metadata": metadata(entries)
            }
        }));

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-tus-limits-"));
        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({
            controller: new LocalStorageController({ basePath: tempDir }),
            requireAuth: false,
            uploadConstraints: createUploadConstraintResolver([posts])
        }));
    });

    afterEach(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    it("refuses an over-large declared length before a byte is received", async () => {
        const res = await create(2048, {
            filename: "big.png",
            filetype: "image/png",
            collection: "posts",
            property: "cover"
        });
        expect(res.status).toBe(413);
        const body = await res.json() as { error: { code: string } };
        expect(body.error.code).toBe("STORAGE_FILE_TOO_LARGE");
    });

    it("refuses a type the property does not accept", async () => {
        const res = await create(10, {
            filename: "payload.exe",
            filetype: "application/x-msdownload",
            collection: "posts",
            property: "cover"
        });
        expect(res.status).toBe(400);
        const body = await res.json() as { error: { code: string } };
        expect(body.error.code).toBe("STORAGE_FILE_TYPE_REFUSED");
    });

    it("creates the upload when both are satisfied", async () => {
        const res = await create(100, {
            filename: "ok.png",
            filetype: "image/png",
            collection: "posts",
            property: "cover"
        });
        expect(res.status).toBe(201);
    });

    it("falls back to the global cap with no property context", async () => {
        const res = await create(2048, { filename: "anything.exe", filetype: "application/x-msdownload" });
        expect(res.status).toBe(201);
    });
});
