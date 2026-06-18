import { z } from "zod";
import { loadEnv } from "../src/env";

describe("env configuration and localhost validation", () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        // Save a backup of the original process.env
        originalEnv = { ...process.env };
        // Clear env vars that might interfere with tests
        delete process.env.NODE_ENV;
        delete process.env.DATABASE_URL;
        delete process.env.ADMIN_CONNECTION_STRING;
        delete process.env.JWT_SECRET;
        delete process.env.FRONTEND_URL;
        delete process.env.CORS_ORIGINS;
        delete process.env.ALLOW_LOCALHOST_IN_PRODUCTION;
    });

    afterEach(() => {
        // Restore process.env after each test
        process.env = originalEnv;
    });

    it("should allow localhost URLs in development mode", () => {
        process.env.NODE_ENV = "development";
        process.env.DATABASE_URL = "postgresql://localhost:5432/rebase";
        process.env.JWT_SECRET = "12345678901234567890123456789012";

        expect(() => loadEnv()).not.toThrow();
        const env = loadEnv();
        expect(env.DATABASE_URL).toBe("postgresql://localhost:5432/rebase");
    });

    it("should fail validation in production if DATABASE_URL contains localhost", () => {
        process.env.NODE_ENV = "production";
        process.env.DATABASE_URL = "postgresql://localhost:5432/rebase";
        process.env.JWT_SECRET = "12345678901234567890123456789012";
        process.env.FRONTEND_URL = "https://my-app.com";

        expect(() => loadEnv()).toThrow(/postgresql:\/\/localhost:5432\/rebase/);
    });

    it("should fail validation in production if DATABASE_URL contains 127.0.0.1", () => {
        process.env.NODE_ENV = "production";
        process.env.DATABASE_URL = "postgresql://127.0.0.1:5432/rebase";
        process.env.JWT_SECRET = "12345678901234567890123456789012";
        process.env.FRONTEND_URL = "https://my-app.com";

        expect(() => loadEnv()).toThrow(/postgresql:\/\/127\.0\.0\.1:5432\/rebase/);
    });

    it("should fail validation in production if DATABASE_URL contains an IPv6 loopback [::1]", () => {
        process.env.NODE_ENV = "production";
        process.env.DATABASE_URL = "postgresql://[::1]:5432/rebase";
        process.env.JWT_SECRET = "12345678901234567890123456789012";
        process.env.FRONTEND_URL = "https://my-app.com";

        expect(() => loadEnv()).toThrow(/postgresql:\/\/\[::1\]:5432\/rebase/);
    });

    it("should fail validation in production if DATABASE_URL contains a loopback in the 127.x.x.x range", () => {
        process.env.NODE_ENV = "production";
        process.env.DATABASE_URL = "postgresql://127.0.0.2:5432/rebase";
        process.env.JWT_SECRET = "12345678901234567890123456789012";
        process.env.FRONTEND_URL = "https://my-app.com";

        expect(() => loadEnv()).toThrow(/postgresql:\/\/127\.0\.0\.2:5432\/rebase/);
    });

    it("should succeed validation in production with a non-localhost DATABASE_URL", () => {
        process.env.NODE_ENV = "production";
        process.env.DATABASE_URL = "postgresql://db.my-app.com:5432/rebase";
        process.env.JWT_SECRET = "12345678901234567890123456789012";
        process.env.FRONTEND_URL = "https://my-app.com";

        expect(() => loadEnv()).not.toThrow();
        const env = loadEnv();
        expect(env.DATABASE_URL).toBe("postgresql://db.my-app.com:5432/rebase");
    });

    it("should allow localhost URLs in production if ALLOW_LOCALHOST_IN_PRODUCTION is set to true", () => {
        process.env.NODE_ENV = "production";
        process.env.DATABASE_URL = "postgresql://localhost:5432/rebase";
        process.env.JWT_SECRET = "12345678901234567890123456789012";
        process.env.FRONTEND_URL = "https://my-app.com";
        process.env.ALLOW_LOCALHOST_IN_PRODUCTION = "true";

        expect(() => loadEnv()).not.toThrow();
        const env = loadEnv();
        expect(env.DATABASE_URL).toBe("postgresql://localhost:5432/rebase");
    });

    it("should not block localhost URLs in CORS_ORIGINS in production mode", () => {
        process.env.NODE_ENV = "production";
        process.env.DATABASE_URL = "postgresql://db.my-app.com:5432/rebase";
        process.env.JWT_SECRET = "12345678901234567890123456789012";
        process.env.FRONTEND_URL = "https://my-app.com";
        process.env.CORS_ORIGINS = "http://localhost:3000,https://my-app.com";

        expect(() => loadEnv()).not.toThrow();
        const env = loadEnv();
        expect(env.CORS_ORIGINS).toBe("http://localhost:3000,https://my-app.com");
    });

    it("should validate and block localhost in extended variables", () => {
        process.env.NODE_ENV = "production";
        process.env.DATABASE_URL = "postgresql://db.my-app.com:5432/rebase";
        process.env.JWT_SECRET = "12345678901234567890123456789012";
        process.env.FRONTEND_URL = "https://my-app.com";
        // Extended URL points to localhost
        process.env.EXTERNAL_SERVICE_URL = "https://localhost:8080/api";

        const extension = {
            extend: z.object({
                EXTERNAL_SERVICE_URL: z.string().url()
            })
        };

        expect(() => loadEnv(extension)).toThrow(/https:\/\/localhost:8080\/api/);
    });

    it("should validate and block plain host string matching localhost", () => {
        process.env.NODE_ENV = "production";
        process.env.DATABASE_URL = "postgresql://db.my-app.com:5432/rebase";
        process.env.JWT_SECRET = "12345678901234567890123456789012";
        process.env.FRONTEND_URL = "https://my-app.com";
        process.env.DB_HOST = "localhost";

        const extension = {
            extend: z.object({
                DB_HOST: z.string()
            })
        };

        expect(() => loadEnv(extension)).toThrow(/localhost/);
    });
});
