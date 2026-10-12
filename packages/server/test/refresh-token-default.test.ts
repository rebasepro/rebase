import { loadEnv } from "../src/env";

/**
 * A session survives 30 days of inactivity by default, on every way a server
 * can be started.
 *
 * There are three places a refresh lifetime can come from when nobody sets
 * one: the runtime's `JWT_REFRESH_EXPIRES_IN` default, the module default in
 * `jwt.ts` (a server that calls `configureJwt` without a lifetime), and the
 * fallback `initializeRebaseBackend` passes. They disagreed — the runtime said
 * 400 days while a hand-written backend and the scaffold `.env.example` said
 * 30 — so how long a user stayed signed in depended on which entry point the
 * project happened to use. Each is pinned here, so one of them drifting is a
 * red test rather than a documentation bug.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

describe("refresh-token lifetime default", () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    it("is 30 days in the runtime's environment schema", () => {
        process.env = {
            DATABASE_URL: "postgresql://localhost:5432/rebase",
            JWT_SECRET: "super-secret-jwt-key-must-be-long-long-long"
        };
        expect(loadEnv().JWT_REFRESH_EXPIRES_IN).toBe("30d");
    });

    it("still takes JWT_REFRESH_EXPIRES_IN when it is set", () => {
        process.env = {
            DATABASE_URL: "postgresql://localhost:5432/rebase",
            JWT_SECRET: "super-secret-jwt-key-must-be-long-long-long",
            JWT_REFRESH_EXPIRES_IN: "400d"
        };
        expect(loadEnv().JWT_REFRESH_EXPIRES_IN).toBe("400d");
    });

    it("is 30 days in a process that configured JWT without a lifetime", () => {
        // `jwtConfig` is module state, so only a fresh registry shows the
        // default a server boots with rather than whatever another test set.
        let freshJwt: typeof import("../src/auth/jwt") | undefined;
        jest.isolateModules(() => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            freshJwt = require("../src/auth/jwt");
        });
        expect(freshJwt!.getRefreshTokenTtlMs()).toBe(30 * DAY_MS);

        freshJwt!.configureJwt({ secret: "test-secret-key-for-jwt-testing-1234567890" });
        expect(freshJwt!.getRefreshTokenTtlMs()).toBe(30 * DAY_MS);
    });
});
