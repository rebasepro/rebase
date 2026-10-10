import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
/**
 * Local storage keeps an object's metadata beside it, as `<key>.metadata.json`,
 * in the same namespace as the objects. A key naming that file was stored like
 * any other, so uploading `a.png.metadata.json` rewrote the metadata `a.png` is
 * served with — its content type among it — while the authorize hook was asked
 * about a different key.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Hono } from "hono";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { LocalStorageController } from "../src/storage/LocalStorageController";
import { createStorageRoutes } from "../src/storage/routes";

const b64 = (s: string) => Buffer.from(s).toString("base64");

describe("local storage refuses the keys of its own files", () => {
    let root: string;
    let app: Hono<HonoEnv>;
    let controller: LocalStorageController;

    const upload = (key: string, body: string, type: string) => {
        const form = new FormData();
        form.append("file", new File([body], key.split("/").pop()!, { type }));
        form.append("key", key);
        return app.request("/api/storage/upload", { method: "POST", body: form });
    };

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-local-reserved-"));
        controller = new LocalStorageController({ type: "local", basePath: root });
        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({ controller, requireAuth: false }));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("refuses an upload over an object's metadata, and the object keeps its own", async () => {
        expect((await upload("avatars/a.png", "png bytes", "image/png")).status).toBe(201);

        const res = await upload("avatars/a.png.metadata.json", JSON.stringify({ contentType: "application/x-evil" }), "application/json");

        expect(res.status).toBe(400);
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe("INVALID_STORAGE_KEY");

        const served = await app.request("/api/storage/file/avatars/a.png");
        expect(served.status).toBe(200);
        expect(served.headers.get("content-type")).toBe("image/png");
    });

    it("does not serve or delete an object's metadata as if it were an object", async () => {
        await upload("avatars/a.png", "png bytes", "image/png");

        expect((await app.request("/api/storage/file/avatars/a.png.metadata.json")).status).toBe(400);
        expect((await app.request("/api/storage/file/avatars/a.png.metadata.json", { method: "DELETE" })).status).toBe(400);
        expect(fs.existsSync(path.join(root, "default", "avatars", "a.png.metadata.json"))).toBe(true);
    });

    it("refuses a TUS upload to such a key before the first chunk", async () => {
        const res = await app.request("/api/storage/tus", {
            method: "POST",
            headers: {
                "Tus-Resumable": "1.0.0",
                "Upload-Length": "2",
                "Upload-Metadata": `key ${b64("x.png.metadata.json")},filetype ${b64("application/json")}`
            }
        });

        expect(res.status).toBe(400);
    });

    it("still stores a key that merely contains the words", async () => {
        expect((await upload("notes/metadata.json.txt", "ok", "text/plain")).status).toBe(201);
        expect((await upload("notes/my.metadata.json.bak", "ok", "text/plain")).status).toBe(201);
    });
});
