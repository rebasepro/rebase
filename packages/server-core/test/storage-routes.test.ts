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
import { createStorageRoutes, extractWildcardPath } from "../src/storage/routes";

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
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-routes-test-"));
        controller = new LocalStorageController({ basePath: tempDir });

        // Upload a test file so we have something to serve
        const content = Buffer.from("Hello test file");
        const file = new File([content], "test.txt", { type: "text/plain" });
        await controller.uploadFile({ file, fileName: "test.txt", path: "photos" });

        // Create the Hono app with storage routes mounted as a SUB-ROUTER
        // (this is the exact pattern that caused the bug)
        app = new Hono<HonoEnv>();
        app.onError(errorHandler);  // required to convert ApiError throws to proper HTTP responses
        const storageRoutes = createStorageRoutes({
            controller,
            requireAuth: false  // skip auth for tests
        });
        app.route("/api/storage", storageRoutes);
    });

    afterEach(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
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

    describe("DELETE /file/*", () => {
        it("should delete an existing file", async () => {
            // Upload another file to delete
            const file = new File([Buffer.from("delete me")], "deleteme.txt", { type: "text/plain" });
            await controller.uploadFile({ file, fileName: "deleteme.txt", path: "photos" });

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
