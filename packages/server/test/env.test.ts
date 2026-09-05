import { loadEnv } from "../src/env";
import { z } from "zod";

/**
 * Assert that a loopback URL is rejected, and that the error names the variable
 * **without echoing its value**.
 *
 * These variables routinely carry credentials (`DATABASE_URL`, `SMTP_PASS`,
 * OAuth secrets), and a failed production boot is written to wherever the
 * container's stdout goes. Naming the variable is enough to fix the problem;
 * printing the value hands the password to the log aggregator.
 */
function expectRedactedLoopbackError(load: () => unknown, variable: string, value: string): void {
    expect(load).toThrow(new RegExp(`${variable}.*local/loopback host`));
    let message = "";
    try {
        load();
    } catch (err) {
        message = err instanceof Error ? err.message : String(err);
    }
    expect(message).not.toContain(value);
}

describe("env configuration and localhost validation", () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        // Clear process.env to ensure fresh test runs
        process.env = {};
        // Add basic fallback requirements to prevent bootstrap crashes
        process.env.DATABASE_URL = "postgresql://localhost:5432/rebase";
        process.env.JWT_SECRET = "super-secret-jwt-key-must-be-long-long-long";
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    it("should parse default env variables in development mode", () => {
        expect(() => loadEnv()).not.toThrow();
        const env = loadEnv();
        expect(env.DATABASE_URL).toBe("postgresql://localhost:5432/rebase");
    });

    it.each(["local", "s3", "gcs"])("should accept STORAGE_TYPE=%s", (type) => {
        // Every `type` BackendStorageConfig supports must validate here: an app
        // selecting its backend from this variable never reaches its own config
        // code if loadEnv rejects the value first.
        process.env.STORAGE_TYPE = type;
        expect(() => loadEnv()).not.toThrow();
        expect(loadEnv().STORAGE_TYPE).toBe(type);
    });

    it("should reject an unknown STORAGE_TYPE", () => {
        process.env.STORAGE_TYPE = "dropbox";
        expect(() => loadEnv()).toThrow();
    });

    it("should fail validation in production if DATABASE_URL contains localhost", () => {
        process.env.NODE_ENV = "production";
        process.env.DATABASE_URL = "postgresql://localhost:5432/rebase";
        process.env.JWT_SECRET = "12345678901234567890123456789012";
        process.env.FRONTEND_URL = "https://my-app.com";

        expectRedactedLoopbackError(() => loadEnv(), "DATABASE_URL", "postgresql://localhost:5432/rebase");
    });

    it("should fail validation in production if DATABASE_URL contains 127.0.0.1", () => {
        process.env.NODE_ENV = "production";
        process.env.DATABASE_URL = "postgresql://127.0.0.1:5432/rebase";
        process.env.JWT_SECRET = "12345678901234567890123456789012";
        process.env.FRONTEND_URL = "https://my-app.com";

        expectRedactedLoopbackError(() => loadEnv(), "DATABASE_URL", "postgresql://127.0.0.1:5432/rebase");
    });

    it("should fail validation in production if DATABASE_URL contains an IPv6 loopback [::1]", () => {
        process.env.NODE_ENV = "production";
        process.env.DATABASE_URL = "postgresql://[::1]:5432/rebase";
        process.env.JWT_SECRET = "12345678901234567890123456789012";
        process.env.FRONTEND_URL = "https://my-app.com";

        expectRedactedLoopbackError(() => loadEnv(), "DATABASE_URL", "postgresql://[::1]:5432/rebase");
    });

    it("should fail validation in production if DATABASE_URL contains a loopback in the 127.x.x.x range", () => {
        process.env.NODE_ENV = "production";
        process.env.DATABASE_URL = "postgresql://127.0.0.2:5432/rebase";
        process.env.JWT_SECRET = "12345678901234567890123456789012";
        process.env.FRONTEND_URL = "https://my-app.com";

        expectRedactedLoopbackError(() => loadEnv(), "DATABASE_URL", "postgresql://127.0.0.2:5432/rebase");
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

        expectRedactedLoopbackError(() => loadEnv(extension), "EXTERNAL_SERVICE_URL", "https://localhost:8080/api");
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

/**
 * A second copy of zod is the difference between a deploy that works and one
 * that comes up, reports success, and runs zero crons.
 *
 * A managed bundle that installed its own zod ran with two copies loaded: the
 * runtime's, which `loadEnv` uses, and the project's, which built the schema
 * passed to `extend`. `.merge()` accepts it — the shapes are structurally
 * identical — and then `.parse()` rejects every field carrying a `.default()`,
 * because a default is recognised by class identity. Nothing in that failure
 * mentioned zod, and it took the whole cron scheduler with it.
 */
describe("loadEnv({ extend }) and zod identity", () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        process.env = {};
        process.env.DATABASE_URL = "postgresql://localhost:5432/rebase";
        process.env.JWT_SECRET = "super-secret-jwt-key-must-be-long-long-long";
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    /**
     * A schema from a genuinely different zod implementation.
     *
     * `zod/v3` is a separate set of classes shipped inside the same package, so
     * `instanceof` against the runtime's `ZodType` is false while `_def` is
     * present and populated — exactly the shape a second *installed* copy
     * produces, without this test depending on one being installed.
     */
    function foreignZodSchema(): unknown {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const foreign = require("zod/v3") as { z: { object: (shape: unknown) => unknown; string: () => { default: (v: string) => unknown } } };
        return foreign.z.object({ STRIPE_KEY: foreign.z.string().default("sk_test") });
    }

    it("fails loudly, naming zod, rather than dropping every default", () => {
        const extend = foreignZodSchema() as never;

        expect(() => loadEnv({ extend })).toThrow(/different copy of zod/);
        expect(() => loadEnv({ extend })).toThrow(/dedupe|dependencies/);
    });

    it("tells a caller who passed something that is not a schema at all", () => {
        expect(() => loadEnv({ extend: { STRIPE_KEY: "string" } as never }))
            .toThrow(/expects a zod object schema/);
    });

    it("still accepts a schema built by the runtime's own zod", () => {
        expect(() => loadEnv({ extend: z.object({ STRIPE_KEY: z.string().default("sk_test") }) }))
            .not.toThrow();
    });
});
