import { describe, it, expect, beforeEach } from "@jest/globals";
import { Hono } from "hono";
import { fileTokenAuth } from "../src/auth/middleware";
import { configureJwt, generateDownloadToken, generateAccessToken } from "../src/auth/jwt";

describe("fileTokenAuth Middleware", () => {
    let app: Hono;

    beforeEach(() => {
        configureJwt({
            secret: "test-secret-key-for-middleware-testing-12345",
            accessExpiresIn: "1h"
        });

        app = new Hono();
        app.get("/api/storage/file/*", fileTokenAuth, (c) => {
            return c.json({ success: true, user: c.get("user") });
        });
        app.get("/api/storage/metadata/*", fileTokenAuth, (c) => {
            return c.json({ success: true, user: c.get("user") });
        });
    });

    it("should allow a valid scoped download token with exact path match", async () => {
        const token = generateDownloadToken("default/uploads/image.png");
        const res = await app.fetch(
            new Request("http://localhost/api/storage/file/default/uploads/image.png?token=" + token)
        );

        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.success).toBe(true);
        expect(body.user).toEqual({ userId: "download-token", roles: ["reader"] });
    });

    it("should allow folder-prefix based scoped download token", async () => {
        // Token is scoped to "default/uploads/"
        const token = generateDownloadToken("default/uploads/");
        const res = await app.fetch(
            new Request("http://localhost/api/storage/file/default/uploads/subfolder/nested.txt?token=" + token)
        );

        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.success).toBe(true);
    });

    it("should deny access if token path does not match requested path", async () => {
        const token = generateDownloadToken("default/secret/data.txt");
        const res = await app.fetch(
            new Request("http://localhost/api/storage/file/default/uploads/image.png?token=" + token)
        );

        expect(res.status).toBe(403);
        const body = await res.json() as any;
        expect(body.error.message).toContain("Forbidden: Scoped token path mismatch");
    });

    it("should reject full access JWT in query parameter ?token=", async () => {
        const fullAccessJwt = generateAccessToken("user-1", ["admin"]);
        const res = await app.fetch(
            new Request("http://localhost/api/storage/file/default/uploads/image.png?token=" + fullAccessJwt)
        );

        expect(res.status).toBe(401);
        const body = await res.json() as any;
        expect(body.error.message).toContain("Unauthorized: Invalid or unauthorized token");
    });

    it("should reject full access JWT in Authorization header for file serving routes", async () => {
        const fullAccessJwt = generateAccessToken("user-1", ["admin"]);
        const res = await app.fetch(
            new Request("http://localhost/api/storage/file/default/uploads/image.png", {
                headers: {
                    Authorization: "Bearer " + fullAccessJwt
                }
            })
        );

        expect(res.status).toBe(401);
        const body = await res.json() as any;
        expect(body.error.message).toContain("Unauthorized: Access JWT not allowed on file routes");
    });

    it("should pass full access JWT in Authorization header for non-file (metadata) routes", async () => {
        const fullAccessJwt = generateAccessToken("user-1", ["admin"]);
        const res = await app.fetch(
            new Request("http://localhost/api/storage/metadata/default/uploads/image.png", {
                headers: {
                    Authorization: "Bearer " + fullAccessJwt
                }
            })
        );

        // fileTokenAuth will let it pass to downstream middleware (e.g. readAuthMiddleware / requireAuth)
        // Since we don't have downstream middleware in this test app, it should return 200 and success: true
        expect(res.status).toBe(200);
    });
});
