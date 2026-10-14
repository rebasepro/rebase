/**
 * `loadEnv()` failing says which variable, in words.
 *
 * Called at the top of a script or a custom server — as custom-server.md has
 * it — and left uncaught, it threw a raw ZodError, which Node prints as
 * `ZodError { name: 'ZodError', message: [Getter/Setter] }`: no variable, no
 * reason, no stack. Caught, its message was a JSON dump of zod's issues. The
 * runtime's own boot already restated the same failure as
 * `DATABASE_URL: is required`; now `loadEnv` throws that.
 */
import { afterEach, describe, expect, it } from "@jest/globals";
import { inspect } from "node:util";
import { loadEnv, z } from "../src/index";
import { loadBootEnv } from "../src/boot/env";

const saved = { ...process.env };

afterEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
});

/**
 * A production environment, complete but for what a test removes: nothing is
 * generated into it and no dev-secret file is written beside the test.
 */
function productionEnv(overrides: Record<string, string | undefined> = {}): void {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, {
        NODE_ENV: "production",
        JWT_SECRET: "j".repeat(48),
        REBASE_SERVICE_KEY: "s".repeat(48),
        CORS_ORIGINS: "https://app.example.com",
        DATABASE_URL: "postgresql://db.example.com:5432/app"
    });
    for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
}

function thrownBy(load: () => unknown): Error & { issues?: unknown[] } {
    try {
        load();
    } catch (error) {
        return error as Error & { issues?: unknown[] };
    }
    throw new Error("expected loadEnv to throw");
}

describe("loadEnv refusing the environment", () => {
    it("throws an Error whose message names the missing variable", () => {
        productionEnv({ DATABASE_URL: undefined });
        const error = thrownBy(() => loadEnv());

        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe("The environment is not valid:\n  DATABASE_URL: is required");
    });

    it("prints that message when nothing catches it, rather than an opaque ZodError", () => {
        productionEnv({ DATABASE_URL: undefined });
        // What Node writes to stderr for an uncaught throw.
        const printed = inspect(thrownBy(() => loadEnv()));

        expect(printed).toContain("DATABASE_URL: is required");
        expect(printed).not.toContain("[Getter/Setter]");
    });

    it("keeps zod's issues on the error, for a caller that reads them", () => {
        productionEnv({ DATABASE_URL: undefined });
        const error = thrownBy(() => loadEnv());

        expect(error.issues).toEqual([expect.objectContaining({ path: ["DATABASE_URL"] })]);
    });

    it("keeps the rule a variable broke when it is set and wrong", () => {
        productionEnv({ DATABASE_URL: "not-a-url" });
        expect(thrownBy(() => loadEnv()).message).toContain("DATABASE_URL: DATABASE_URL must be a valid URL");
    });

    it("names a variable of the app's own schema, and every problem at once", () => {
        productionEnv({ DATABASE_URL: undefined });
        const error = thrownBy(() => loadEnv({ extend: z.object({ STRIPE_SECRET_KEY: z.string() }) }));

        expect(error.message).toContain("  DATABASE_URL: is required");
        expect(error.message).toContain("  STRIPE_SECRET_KEY: is required");
    });
});

describe("the runtime's boot", () => {
    it("says the same thing, with where to read more", () => {
        productionEnv({ DATABASE_URL: undefined });
        const error = thrownBy(() => loadBootEnv());

        expect(error.message).toContain("The environment is not valid:\n  DATABASE_URL: is required");
    });
});
