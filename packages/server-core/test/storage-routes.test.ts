import { describe, it, expect, beforeEach, afterEach, jest as vi } from "@jest/globals";
/**
 * Tests for storage routes — specifically the sub-router wildcard extraction
 * that broke when Hono's c.req.param('*') stopped working in mounted sub-routers.
 *
 * These tests use Hono's built-in `app.fetch()` to simulate requests without
 * needing a running HTTP server, which keeps them fast and deterministic.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Hono } from "hono";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { LocalStorageController } from "../src/storage/LocalStorageController";
import { DefaultStorageRegistry } from "../src/storage/storage-registry";
import { createStorageRoutes, extractWildcardPath } from "../src/storage/routes";
import { configureJwt, generateDownloadToken } from "../src/auth/jwt";

// ──────────────────────────────────────────────────────────────────────
// Unit tests for extractWildcardPath
// ──────────────────────────────────────────────────────────────────────

describe("extractWildcardPath", () => {
    it("should extract path after the route prefix", () => {
        const result = extractWildcardPath({
            req: {
                path: "/api/storage/metadata/default/author_pictures/photo.jpg",
                routePath: "/api/storage/metadata/*"
            }
        });
        expect(result).toBe("default/author_pictures/photo.jpg");
    });

    it("should extract simple file path", () => {
        const result = extractWildcardPath({
            req: {
                path: "/api/storage/file/testfile.jpg",
                routePath: "/api/storage/file/*"
            }
        });
        expect(result).toBe("testfile.jpg");
    });

    it("should return empty string for trailing-slash-only path", () => {
        const result = extractWildcardPath({
            req: {
                path: "/api/storage/metadata/",
                routePath: "/api/storage/metadata/*"
            }
        });
        expect(result).toBe("");
    });

    it("should return empty string when path equals prefix (no trailing slash)", () => {
        const result = extractWildcardPath({
            req: {
                path: "/api/storage/metadata",
                routePath: "/api/storage/metadata/*"
            }
        });
        expect(result).toBe("");
    });

    it("should handle deeply nested paths", () => {
        const result = extractWildcardPath({
            req: {
                path: "/api/storage/file/bucket/a/b/c/d/file.png",
                routePath: "/api/storage/file/*"
            }
        });
        expect(result).toBe("bucket/a/b/c/d/file.png");
    });

    it("should handle paths with spaces and special chars", () => {
        const result = extractWildcardPath({
            req: {
                path: "/api/storage/file/default/photos/my%20file%20(1).png",
                routePath: "/api/storage/file/*"
            }
        });
        expect(result).toBe("default/photos/my%20file%20(1).png");
    });
});

// ──────────────────────────────────────────────────────────────────────
// Integration tests: storage routes mounted as Hono sub-router
// ──────────────────────────────────────────────────────────────────────

describe("Storage routes (sub-router integration)", () => {
    let app: Hono<HonoEnv>;
    let tempDir: string;
    let controller: LocalStorageController;

    beforeEach(async () => {
        configureJwt({ secret: "test-secret-key-for-jwt-testing-1234567890" });
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-routes-test-"));
        controller = new LocalStorageController({ basePath: tempDir });

        // Upload a test file so we have something to serve
        const content = Buffer.from("Hello test file");
        const file = new File([content], "test.txt", { type: "text/plain" });
        await controller.putObject({ file,
key: "photos/test.txt" });

        // Create the Hono app with storage routes mounted as a SUB-ROUTER
        // (this is the exact pattern that caused the bug)
        app = new Hono<HonoEnv>();
        app.onError(errorHandler); // required to convert ApiError throws to proper HTTP responses
        const storageRoutes = createStorageRoutes({
            controller,
            requireAuth: false // skip auth for tests
        });
        app.route("/api/storage", storageRoutes);
    });

    afterEach(async () => {
        await fs.promises.rm(tempDir, { recursive: true,
force: true });
    });

    describe("GET /metadata/*", () => {
        it("should return metadata for a valid file path", async () => {
            const res = await app.fetch(
                new Request("http://localhost/api/storage/metadata/default/photos/test.txt")
            );

            expect(res.status).toBe(200);
            const body = await res.json() as { success: boolean; data: { contentType: string } };
            expect(body.success).toBe(true);
            expect(body.data).toBeDefined();
            expect(body.data.contentType).toBe("text/plain");
        });

        it("should return metadata without explicit bucket prefix", async () => {
            const res = await app.fetch(
                new Request("http://localhost/api/storage/metadata/photos/test.txt")
            );

            expect(res.status).toBe(200);
            const body = await res.json() as { success: boolean; data: { contentType: string } };
            expect(body.success).toBe(true);
            expect(body.data).toBeDefined();
        });

        it("should return 404 for empty path", async () => {
            const res = await app.fetch(
                new Request("http://localhost/api/storage/metadata/")
            );
            expect(res.status).toBe(404);
        });

        it("should return 404 for non-existent file", async () => {
            const res = await app.fetch(
                new Request("http://localhost/api/storage/metadata/default/nope/missing.txt")
            );
            expect(res.status).toBe(404);
        });
    });

    describe("GET /file/*", () => {
        it("should serve file content for a valid path", async () => {
            const res = await app.fetch(
                new Request("http://localhost/api/storage/file/default/photos/test.txt")
            );

            expect(res.status).toBe(200);
            const body = await res.text();
            expect(body).toBe("Hello test file");
        });

        it("should serve file without explicit bucket prefix", async () => {
            const res = await app.fetch(
                new Request("http://localhost/api/storage/file/photos/test.txt")
            );

            expect(res.status).toBe(200);
            const body = await res.text();
            expect(body).toBe("Hello test file");
        });

        it("should return 404 for empty path", async () => {
            const res = await app.fetch(
                new Request("http://localhost/api/storage/file/")
            );
            expect(res.status).toBe(404);
        });

        it("should return 404 for non-existent file", async () => {
            const res = await app.fetch(
                new Request("http://localhost/api/storage/file/default/nope/missing.txt")
            );
            expect(res.status).toBe(404);
        });
    });

    describe("GET /sources", () => {
        it("returns the default source in single-controller mode", async () => {
            const res = await app.fetch(new Request("http://localhost/api/storage/sources"));
            expect(res.status).toBe(200);
            const body = await res.json() as { success: boolean; data: Array<{ key: string; engine: string; transport: string }> };
            expect(body.success).toBe(true);
            expect(body.data).toEqual([
                { key: "(default)", engine: "local", transport: "server" }
            ]);
        });

        it("merges declared definitions, including direct sources and labels", async () => {
            const declaredApp = new Hono<HonoEnv>();
            declaredApp.onError(errorHandler);
            const routes = createStorageRoutes({
                controller,
                requireAuth: false,
                sources: [
                    { key: "(default)", engine: "local", transport: "server", label: "Local" },
                    { key: "firebase", engine: "firebase", transport: "direct", label: "Firebase Storage" }
                ]
            });
            declaredApp.route("/api/storage", routes);

            const res = await declaredApp.fetch(new Request("http://localhost/api/storage/sources"));
            expect(res.status).toBe(200);
            const body = await res.json() as { success: boolean; data: Array<{ key: string; engine: string; transport: string; label?: string }> };
            expect(body.data).toContainEqual({ key: "(default)", engine: "local", transport: "server", label: "Local" });
            expect(body.data).toContainEqual({ key: "firebase", engine: "firebase", transport: "direct", label: "Firebase Storage" });
        });
    });

    describe("DELETE /file/*", () => {
        it("should delete an existing file", async () => {
            // Upload another file to delete
            const file = new File([Buffer.from("delete me")], "deleteme.txt", { type: "text/plain" });
            await controller.putObject({ file,
key: "photos/deleteme.txt" });

            const res = await app.fetch(
                new Request("http://localhost/api/storage/file/default/photos/deleteme.txt", { method: "DELETE" })
            );

            expect(res.status).toBe(200);
            const body = await res.json() as { success: boolean };
            expect(body.success).toBe(true);

            // Verify the file is actually gone
            const filePath = path.join(tempDir, "default", "photos", "deleteme.txt");
            const exists = await fs.promises.access(filePath).then(() => true).catch(() => false);
            expect(exists).toBe(false);
        });

        it("should handle empty path gracefully", async () => {
            const res = await app.fetch(
                new Request("http://localhost/api/storage/file/", { method: "DELETE" })
            );
            expect(res.status).toBe(200);
        });
    });
});

// ──────────────────────────────────────────────────────────────────────
// Multi-backend routing through the StorageRegistry
// ──────────────────────────────────────────────────────────────────────
describe("Storage routes — multi-backend routing (registry)", () => {
    let app: Hono<HonoEnv>;
    let defaultDir: string;
    let secondaryDir: string;

    beforeEach(async () => {
        configureJwt({ secret: "test-secret-key-for-jwt-testing-1234567890" });
        defaultDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-default-"));
        secondaryDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-secondary-"));

        const registry = DefaultStorageRegistry.create({
            "(default)": new LocalStorageController({ basePath: defaultDir }),
            secondary: new LocalStorageController({ basePath: secondaryDir })
        });

        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({
            registry,
            requireAuth: false,
            sources: [
                { key: "(default)", engine: "local", transport: "server" },
                { key: "secondary", engine: "local", transport: "server", label: "Secondary" }
            ]
        }));
    });

    afterEach(async () => {
        await fs.promises.rm(defaultDir, { recursive: true, force: true });
        await fs.promises.rm(secondaryDir, { recursive: true, force: true });
    });

    async function upload(storageId: string | undefined, key: string, content: string) {
        const fd = new FormData();
        fd.append("file", new File([Buffer.from(content)], "file.txt", { type: "text/plain" }));
        fd.append("key", key);
        if (storageId) fd.append("storageId", storageId);
        return app.fetch(new Request("http://localhost/api/storage/upload", { method: "POST", body: fd }));
    }

    it("routes an upload to the backend named by storageId", async () => {
        const res = await upload("secondary", "docs/secret.txt", "in-secondary");
        expect(res.ok).toBe(true);

        // It physically landed in the secondary backend, not the default one.
        const inSecondary = await app.fetch(
            new Request("http://localhost/api/storage/file/default/docs/secret.txt?storageId=secondary")
        );
        expect(inSecondary.status).toBe(200);
        expect(await inSecondary.text()).toBe("in-secondary");

        // The default backend does not have it.
        const inDefault = await app.fetch(
            new Request("http://localhost/api/storage/file/default/docs/secret.txt")
        );
        expect(inDefault.status).toBe(404);
    });

    it("keeps the same key isolated per backend", async () => {
        await upload(undefined, "shared.txt", "from-default");
        await upload("secondary", "shared.txt", "from-secondary");

        const d = await app.fetch(new Request("http://localhost/api/storage/file/default/shared.txt"));
        const s = await app.fetch(new Request("http://localhost/api/storage/file/default/shared.txt?storageId=secondary"));
        expect(await d.text()).toBe("from-default");
        expect(await s.text()).toBe("from-secondary");
    });

    it("serves metadata from the backend named by storageId", async () => {
        await upload("secondary", "m.txt", "x");
        const res = await app.fetch(
            new Request("http://localhost/api/storage/metadata/default/m.txt?storageId=secondary")
        );
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: { contentType: string } };
        expect(body.success).toBe(true);
        expect(body.data.contentType).toBe("text/plain");
    });

    it("lists only the targeted backend's contents", async () => {
        await upload(undefined, "only-default.txt", "a");
        await upload("secondary", "only-secondary.txt", "b");

        const res = await app.fetch(new Request("http://localhost/api/storage/list?storageId=secondary"));
        const body = await res.json() as { data: { items: Array<{ name: string }> } };
        const names = body.data.items.map((i) => i.name);
        expect(names).toContain("only-secondary.txt");
        expect(names).not.toContain("only-default.txt");
    });

    it("deletes from the backend named by storageId", async () => {
        await upload("secondary", "del.txt", "bye");

        const del = await app.fetch(
            new Request("http://localhost/api/storage/file/default/del.txt?storageId=secondary", { method: "DELETE" })
        );
        expect(del.status).toBe(200);

        const after = await app.fetch(
            new Request("http://localhost/api/storage/file/default/del.txt?storageId=secondary")
        );
        expect(after.status).toBe(404);
    });

    it("falls back to the default backend for an unknown storageId", async () => {
        const res = await upload("does-not-exist", "fallback.txt", "fell-back");
        expect(res.ok).toBe(true);

        // Unknown id falls back to default, so the file is in the default backend.
        const inDefault = await app.fetch(
            new Request("http://localhost/api/storage/file/default/fallback.txt")
        );
        expect(inDefault.status).toBe(200);
        expect(await inDefault.text()).toBe("fell-back");
    });

    it("lists both backends via GET /sources", async () => {
        const res = await app.fetch(new Request("http://localhost/api/storage/sources"));
        const body = await res.json() as { data: Array<{ key: string; engine: string; label?: string }> };
        const keys = body.data.map((s) => s.key);
        expect(keys).toEqual(expect.arrayContaining(["(default)", "secondary"]));
        expect(body.data.find((s) => s.key === "secondary")?.label).toBe("Secondary");
    });
});

// ──────────────────────────────────────────────────────────────────────
// Scoped download tokens under an AuthAdapter (requireAuth + private reads)
//
// Regression: when storage routes run with an `authAdapter` and private
// reads (requireAuth: true, publicRead: false), the adapter-backed read
// middleware must honor the user that `fileTokenAuth` sets from a scoped
// `?token=` download token. The adapter cannot understand file-read tokens,
// so enforcing purely on its own result would 401 an otherwise-valid `<img>`
// request — exactly what broke image serving in the demo.
// ──────────────────────────────────────────────────────────────────────
describe("Storage routes — scoped download token under AuthAdapter", () => {
    let app: Hono<HonoEnv>;
    let tempDir: string;
    let controller: LocalStorageController;

    beforeEach(async () => {
        configureJwt({ secret: "test-secret-key-for-jwt-testing-1234567890" });
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-token-adapter-"));
        controller = new LocalStorageController({ basePath: tempDir });

        await controller.putObject({
            file: new File([Buffer.from("secret image bytes")], "logo.png", { type: "image/png" }),
            key: "author_pictures/logo.png"
        });

        // Adapter that only understands access JWTs — it returns null for the
        // scoped file-read `?token=`, mirroring the demo's custom auth.
        const authAdapter = {
            verifyRequest: async (_req: Request) => null
        };

        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({
            controller,
            requireAuth: true,
            publicRead: false,
            authAdapter
        }));
    });

    afterEach(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    it("serves a private file via a valid scoped ?token=", async () => {
        const token = generateDownloadToken("default/author_pictures/logo.png", 300);
        const res = await app.fetch(
            new Request(`http://localhost/api/storage/file/author_pictures/logo.png?token=${token}`)
        );

        expect(res.status).toBe(200);
        expect(await res.text()).toBe("secret image bytes");
    });

    it("rejects a request with no token as unauthorized", async () => {
        const res = await app.fetch(
            new Request("http://localhost/api/storage/file/author_pictures/logo.png")
        );
        expect(res.status).toBe(401);
    });

    it("rejects a scoped token for a different path", async () => {
        const token = generateDownloadToken("default/author_pictures/other.png", 300);
        const res = await app.fetch(
            new Request(`http://localhost/api/storage/file/author_pictures/logo.png?token=${token}`)
        );
        expect(res.status).toBe(403);
    });
});
