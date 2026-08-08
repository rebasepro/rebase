import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
/**
 * What `/file/*` serves is not what the uploader said it was.
 *
 * Nothing sniffs: `putObject` stores `file.type` from the multipart part and
 * TUS stores an `Upload-Metadata` value, and the read route echoed that string
 * back as the response `Content-Type`. So uploading `public/x.html` declaring
 * `text/html` made the API origin host attacker HTML — and where `cookieAuth`
 * is enabled the refresh cookie is `Path=/` on exactly that origin, which puts
 * `fetch("/api/auth/refresh")` and a fresh access token inside the injected
 * page's reach, `HttpOnly` notwithstanding.
 *
 * The response type is now an allowlist, everything else is downloaded rather
 * than rendered, and `nosniff` is unconditional.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Hono } from "hono";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { LocalStorageController } from "../src/storage/LocalStorageController";
import { createStorageRoutes, resolveServedContentType } from "../src/storage/routes";
import { configureJwt } from "../src/auth/jwt";

describe("resolveServedContentType", () => {
    it.each([
        "image/png",
        "image/jpeg",
        "image/webp",
        "video/mp4",
        "audio/mpeg",
        "application/pdf",
        "text/plain"
    ])("renders %s inline", (type) => {
        expect(resolveServedContentType(type)).toEqual({ contentType: type, attachment: false });
    });

    it.each([
        "text/html",
        "text/html; charset=utf-8",
        "TEXT/HTML",
        "application/xhtml+xml",
        "image/svg+xml",
        "image/svg+xml; charset=utf-8",
        "application/javascript",
        "text/xml",
        "application/octet-stream"
    ])("downloads %s instead of rendering it", (type) => {
        expect(resolveServedContentType(type)).toEqual({
            contentType: "application/octet-stream",
            attachment: true
        });
    });
});

describe("GET /file/* never serves the uploader's claim as a renderable type", () => {
    let app: Hono<HonoEnv>;
    let tempDir: string;
    let controller: LocalStorageController;

    const store = async (key: string, body: string, type: string) => {
        await controller.putObject({ file: new File([Buffer.from(body)], path.basename(key), { type }), key });
    };

    beforeEach(async () => {
        configureJwt({ secret: "test-secret-key-for-jwt-testing-1234567890" });
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-served-type-"));
        controller = new LocalStorageController({ basePath: tempDir });

        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({ controller, requireAuth: false }));
    });

    afterEach(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    it("serves an uploaded HTML page as a download, not as a page", async () => {
        await store("public/x.html", "<script>alert(document.domain)</script>", "text/html");

        const res = await app.fetch(new Request("http://localhost/api/storage/file/public/x.html"));

        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
        expect(res.headers.get("Content-Disposition")).toBe("attachment");
        expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
        // The bytes are still the caller's; only how they are delivered changed.
        expect(await res.text()).toContain("alert(document.domain)");
    });

    it("serves an uploaded SVG as a download — an SVG is a document that can script", async () => {
        await store("public/x.svg", "<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>", "image/svg+xml");

        const res = await app.fetch(new Request("http://localhost/api/storage/file/public/x.svg"));

        expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
        expect(res.headers.get("Content-Disposition")).toBe("attachment");
    });

    it("still renders an image inline, with nosniff and no forced download", async () => {
        await store("photos/a.png", "not really a png", "image/png");

        const res = await app.fetch(new Request("http://localhost/api/storage/file/photos/a.png"));

        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toBe("image/png");
        expect(res.headers.get("Content-Disposition")).toBeNull();
        expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    });

    it("does not let a trailing parameter smuggle a type past the allowlist", async () => {
        await store("public/y.html", "<h1>hi</h1>", "text/html; charset=utf-8");

        const res = await app.fetch(new Request("http://localhost/api/storage/file/public/y.html"));

        expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    });
});
