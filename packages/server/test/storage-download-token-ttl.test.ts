import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
/**
 * How long a private file's download URL works.
 *
 * The token `/metadata` mints for a private object was a 300-second literal.
 * Five minutes is right for a thumbnail and wrong for a private `<video>`,
 * which keeps asking for ranges long after the page rendered — and nothing
 * could change it.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { LocalStorageController } from "../src/storage/LocalStorageController";
import { createStorageRoutes } from "../src/storage/routes";
import { configureJwt } from "../src/auth/jwt";
import { loadBootEnv } from "../src/boot/env";

const claims = (token: string) =>
    JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf-8")) as { iat: number; exp: number };

describe("the download token's lifetime", () => {
    let root: string;
    let controller: LocalStorageController;

    beforeEach(async () => {
        configureJwt({ secret: "test-secret-key-for-jwt-testing-1234567890" });
        root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-token-ttl-"));
        controller = new LocalStorageController({ type: "local", basePath: root });
        await controller.putObject({ file: new File(["x"], "a.mp4", { type: "video/mp4" }), key: "videos/a.mp4" });
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    const metadata = async (ttl?: number) => {
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({ controller, requireAuth: false, downloadTokenTtlSeconds: ttl }));
        const res = await app.request("/api/storage/metadata/videos/a.mp4");
        expect(res.status).toBe(200);
        return (await res.json() as { data: { token: string; tokenExpiresIn: number } }).data;
    };

    it("is five minutes unless configured", async () => {
        const data = await metadata();
        expect(data.tokenExpiresIn).toBe(300);
        const { iat, exp } = claims(data.token);
        expect(exp - iat).toBe(300);
    });

    it("is what the deployment configures, in the token and in what the client is told", async () => {
        const data = await metadata(3600);
        expect(data.tokenExpiresIn).toBe(3600);
        const { iat, exp } = claims(data.token);
        expect(exp - iat).toBe(3600);
    });

    it("marks the token with the user who minted it, for the rate limiter", async () => {
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.use("*", async (c, next) => {
            c.set("user", { uid: "editor-1", roles: ["editor"] });
            await next();
        });
        app.route("/api/storage", createStorageRoutes({ controller, requireAuth: false }));
        const res = await app.request("/api/storage/metadata/videos/a.mp4");
        const { token } = (await res.json() as { data: { token: string } }).data;
        const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf-8")) as { rl?: string };
        expect(typeof payload.rl).toBe("string");
        expect(JSON.stringify(payload)).not.toContain("editor-1");
    });

    it.each([0, -1, 1.5, 604801, Number.NaN])("refuses %s when the routes are built", (ttl) => {
        expect(() => createStorageRoutes({ controller, requireAuth: false, downloadTokenTtlSeconds: ttl }))
            .toThrow(/download token/i);
    });
});

describe("STORAGE_DOWNLOAD_TOKEN_TTL", () => {
    const saved = { ...process.env };

    beforeEach(() => {
        process.env.NODE_ENV = "production";
        process.env.JWT_SECRET = "j".repeat(48);
        process.env.REBASE_SERVICE_KEY = "s".repeat(48);
        process.env.CORS_ORIGINS = "https://app.example.com";
        process.env.DATABASE_URL = "postgresql://db.example.com:5432/app";
    });

    afterEach(() => {
        for (const key of Object.keys(process.env)) {
            if (!(key in saved)) delete process.env[key];
        }
        Object.assign(process.env, saved);
    });

    it("is read in seconds", () => {
        process.env.STORAGE_DOWNLOAD_TOKEN_TTL = "3600";
        expect(loadBootEnv().STORAGE_DOWNLOAD_TOKEN_TTL).toBe(3600);
    });

    it("is unset when blank, so the default applies", () => {
        process.env.STORAGE_DOWNLOAD_TOKEN_TTL = "";
        expect(loadBootEnv().STORAGE_DOWNLOAD_TOKEN_TTL).toBeUndefined();
    });

    it.each(["abc", "0", "1.5", "604801", "5m"])("refuses %s at boot, naming the variable", (value) => {
        process.env.STORAGE_DOWNLOAD_TOKEN_TTL = value;
        expect(() => loadBootEnv()).toThrow(/STORAGE_DOWNLOAD_TOKEN_TTL/);
    });
});
