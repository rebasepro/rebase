import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Hono } from "hono";
import { col, defineTable, json } from "@rebasepro/types";
import { compileTables } from "@rebasepro/common";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { LocalStorageController } from "../src/storage/LocalStorageController";
import { createStorageRoutes } from "../src/storage/routes";
import {
    createUploadConstraintResolver,
    isAcceptedFile,
    readUploadColumnContext
} from "../src/storage/column-limits";

/**
 * A storage column's `maxBytes` and `accept` were published in the generated
 * types, rendered by the panel's file picker — and once enforced by the
 * browser and nothing else. `curl -F file=@payload.exe` past the picker put a
 * 40 MB executable in a bucket whose schema said "images, under 200 KB".
 */
const [posts] = compileTables([defineTable("posts", {
    columns: {
        id: col.serial().primaryKey(),
        cover: col.storage({ path: "covers", maxBytes: 1024, accept: ["image/*"] }),
        attachment: col.storage({ path: "docs", accept: [".pdf"] }),
        gallery: col.storage({ path: "gallery", maxBytes: 512 }).multiple(),
        meta: col.jsonb(json.object({ avatar: json.storage({ path: "avatars", maxBytes: 256 }) })),
        // A storage column that declares no limits at all.
        loose: col.storage({ path: "loose" }),
        title: col.text()
    },
    rls: "admin-only"
})]);

describe("createUploadConstraintResolver", () => {
    const resolve = createUploadConstraintResolver([posts]);

    it("finds a top-level storage column", () => {
        expect(resolve("posts", "cover")).toEqual({
            maxSize: 1024,
            acceptedFiles: ["image/*"],
            source: "posts.cover"
        });
    });

    it("descends into a json object", () => {
        expect(resolve("posts", "meta.avatar")?.maxSize).toBe(256);
    });

    it("reads the items of a column of several files", () => {
        // The file being uploaded is an *item*, and every item obeys the
        // column's storage rules.
        expect(resolve("posts", "gallery")?.maxSize).toBe(512);
        expect(resolve("posts", "gallery.2")?.maxSize).toBe(512);
    });

    it("says nothing for a column that declares no limits", () => {
        expect(resolve("posts", "loose")).toBeUndefined();
        expect(resolve("posts", "title")).toBeUndefined();
    });

    it("says nothing for an unknown table or column", () => {
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

describe("readUploadColumnContext", () => {
    it("reads both fields or nothing", () => {
        // The wire fields are the client's: `collection` names the table, `property` the column.
        expect(readUploadColumnContext({ collection: "posts", property: "cover" }))
            .toEqual({ table: "posts", column: "cover" });
        expect(readUploadColumnContext({ collection: "posts" })).toBeUndefined();
        expect(readUploadColumnContext({ collection: "  ", property: "cover" })).toBeUndefined();
        expect(readUploadColumnContext(undefined)).toBeUndefined();
    });
});

describe("POST /upload enforces the destination column's limits", () => {
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
            controller: new LocalStorageController({ type: "local", basePath: tempDir }),
            requireAuth: false,
            uploadConstraints: createUploadConstraintResolver([posts])
        }));
    });

    afterEach(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    it("refuses a file over the column's maxBytes with a 413 naming the column", async () => {
        const res = await upload(new Blob(["x".repeat(2048)], { type: "image/png" }), "big.png", {
            collection: "posts",
            property: "cover"
        });
        expect(res.status).toBe(413);
        const body = await res.json() as { error: { code: string; message: string; details?: { column?: string; maxSize?: number } } };
        expect(body.error.code).toBe("STORAGE_FILE_TOO_LARGE");
        expect(body.error.message).toContain("posts.cover");
        expect(body.error.details?.maxSize).toBe(1024);
    });

    it("refuses a file the column does not accept with a 400", async () => {
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

    it("enforces a column of several files item limits", async () => {
        const res = await upload(new Blob(["x".repeat(1000)], { type: "image/png" }), "g.png", {
            collection: "posts",
            property: "gallery"
        });
        expect(res.status).toBe(413);
    });

    it("enforces a json field.s limits", async () => {
        const res = await upload(new Blob(["x".repeat(1000)], { type: "image/png" }), "a.png", {
            collection: "posts",
            property: "meta.avatar"
        });
        expect(res.status).toBe(413);
    });

    it("falls back to the global cap when the request names no column", async () => {
        // An upload that names no column has no column limit to check, and
        // refusing every context-less upload would break every existing client.
        const res = await upload(new Blob(["x".repeat(4096)], { type: "application/x-msdownload" }), "anything.exe");
        expect(res.status).toBe(201);
    });

    it("falls back when the named column declares no limits", async () => {
        const res = await upload(new Blob(["x".repeat(4096)], { type: "application/x-msdownload" }), "l.exe", {
            collection: "posts",
            property: "loose"
        });
        expect(res.status).toBe(201);
    });

    it("cannot be widened by naming an unknown column", async () => {
        // Naming a column can make an upload stricter or leave it at the
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
        // Unknown column → no column rule → the global cap, which this file
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
            controller: new LocalStorageController({ type: "local", basePath: tempDir }),
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

    it("refuses a type the column does not accept", async () => {
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

    it("falls back to the global cap with no column context", async () => {
        const res = await create(2048, { filename: "anything.exe", filetype: "application/x-msdownload" });
        expect(res.status).toBe(201);
    });

    /**
     * The metadata can carry a type twice — `filetype` (the tus-js-client
     * convention) and `contentType` — and the check read them in one order
     * while `finalize` stored them in the other. So a property that accepts
     * only images judged `filetype: image/png` and stored `contentType:
     * text/html`.
     */
    it("judges the content type it will store, when the metadata names two", async () => {
        const res = await create(10, {
            filename: "ok.png",
            filetype: "image/png",
            contentType: "text/html",
            collection: "posts",
            property: "cover"
        });

        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: { code: "STORAGE_FILE_TYPE_REFUSED" } });
    });

    it("stores the content type it judged", async () => {
        const created = await create(2, {
            key: "covers/ok.png",
            filetype: "text/html",
            contentType: "image/png",
            collection: "posts",
            property: "cover"
        });
        expect(created.status).toBe(201);

        // Resolved against the endpoint, as a TUS client resolves it: the
        // server answers a path, so no proxy can put the wrong origin in it.
        const uploadUrl = new URL(created.headers.get("Location")!, "http://localhost/api/storage/tus");
        const patched = await app.fetch(new Request(uploadUrl, {
            method: "PATCH",
            headers: { "Upload-Offset": "0", "Content-Type": "application/offset+octet-stream" },
            body: "hi"
        }));
        expect(patched.status).toBe(204);

        const stored = JSON.parse(await fs.promises.readFile(
            path.join(tempDir, "default", "covers", "ok.png.metadata.json"),
            "utf-8"
        )) as { contentType: string };
        expect(stored.contentType).toBe("image/png");
    });
});
