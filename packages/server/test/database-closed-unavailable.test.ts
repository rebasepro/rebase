import { afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { Hono } from "hono";
import type { DataDriver } from "@rebasepro/types";
import { errorHandler, isDatabaseUnreachable } from "../src/index";
import type { AuthRepository } from "../src/auth/interfaces";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import { createAdapterAuthMiddleware } from "../src/auth/adapter-middleware";
import { createBuiltinAuthAdapter } from "../src/auth/builtin-auth-adapter";
import { createRequireAuth } from "../src/auth/middleware";
import { _resetClosedDatabaseWarningForTests } from "../src/api/closed-database";
import type { HonoEnv } from "../src/api/types";
import { logger } from "../src/utils/logger";

/**
 * A database closed to new connections is a database that cannot serve the
 * request: `503 DATABASE_UNAVAILABLE` with `Retry-After`, as for one that is
 * down — and the operator is told which database is closed, and how to open it.
 *
 * A `rebase db branch create --force` killed mid-copy leaves its source with
 * `ALLOW_CONNECTIONS false`. Every new connection to it is refused with
 * SQLSTATE 55000, `database "x" is not currently accepting connections`. The
 * running app answered signed-in requests `503 ROLE_LOOKUP_FAILED` "Could not
 * verify your permissions" — a doubt about the caller nobody was in a position
 * to have — and a route's own query a `500`.
 *
 * 55000 alone is not the signal: it is also `lastval is not yet defined in this
 * session`, a statement the database judged. The sentence is.
 */

/** What node-postgres raises for a connection to a database that is closed. */
function closed(database = "rebase"): Error {
    return Object.assign(new Error(`database "${database}" is not currently accepting connections`), {
        code: "55000", severity: "FATAL"
    });
}

/** Drizzle's wrapper around a query the driver could not run. */
function failedQuery(cause: unknown): Error {
    return Object.assign(new Error("Failed query: select 1\nparams: "), { query: "select 1", params: [], cause });
}

const notYetDefined = () => Object.assign(new Error("lastval is not yet defined in this session"), { code: "55000", severity: "ERROR" });

let logged: string[];

beforeAll(() => {
    configureJwt({ secret: "database-closed-test-secret-0123456789abcdef", accessExpiresIn: "1h" });
});

function captureLogs(): void {
    logged = [];
    _resetClosedDatabaseWarningForTests();
    const keep = (message: string) => { logged.push(message); };
    jest.spyOn(logger, "error").mockImplementation(keep);
    jest.spyOn(logger, "warn").mockImplementation(keep);
}

afterEach(() => {
    jest.restoreAllMocks();
});

/**
 * The line that says which database is closed and what opens it. A request's
 * own log line may say it is closed too; this is the one with the remedy.
 */
function closedLines(): string[] {
    return logged.filter(line => line.includes("closed to new connections") && line.includes("ALLOW_CONNECTIONS true"));
}

function expectNamesTheFix(line: string, database: string): void {
    expect(line).toContain(`"${database}"`);
    expect(line).toContain("rebase db branch list");
    expect(line).toContain(`ALTER DATABASE "${database}" ALLOW_CONNECTIONS true`);
}

describe("isDatabaseUnreachable", () => {
    it("reads a database closed to new connections as one that cannot be reached", () => {
        expect(isDatabaseUnreachable(closed())).toBe(true);
        expect(isDatabaseUnreachable(failedQuery(closed()))).toBe(true);
    });

    it("does not read every 55000 so", () => {
        expect(isDatabaseUnreachable(notYetDefined())).toBe(false);
        expect(isDatabaseUnreachable(failedQuery(notYetDefined()))).toBe(false);
    });
});

describe("the error handler, with the database closed", () => {
    function appThrowing(error: unknown): Hono<HonoEnv> {
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.get("/x", () => {
            throw error;
        });
        return app;
    }

    it("answers 503 DATABASE_UNAVAILABLE with Retry-After, and says once which database and what opens it", async () => {
        captureLogs();
        for (let request = 0; request < 3; request++) {
            const res = await appThrowing(failedQuery(closed("shop"))).request("/x");
            expect(res.status).toBe(503);
            expect(res.headers.get("Retry-After")).toBe("5");
            expect((await res.json() as { error: { code: string } }).error.code).toBe("DATABASE_UNAVAILABLE");
        }
        expect(closedLines()).toHaveLength(1);
        expectNamesTheFix(closedLines()[0], "shop");
        expect(logged.join("\n")).not.toMatch(/database is unreachable/);
    });

    it("leaves a 55000 the database judged as the statement's failure", async () => {
        captureLogs();
        const res = await appThrowing(failedQuery(notYetDefined())).request("/x");
        expect(res.status).toBe(500);
    });
});

describe("the auth doors, with the database closed", () => {
    const closedRepo = {
        getUserRoleIds: async () => { throw failedQuery(closed()); },
        getUserById: async () => { throw failedQuery(closed()); }
    } as unknown as AuthRepository;

    const passThroughDriver = {
        key: "pass",
        initialised: true,
        withAuth: async () => passThroughDriver
    } as unknown as DataDriver;

    async function dataPlane(): Promise<{ status: number; code: string; retryAfter: string | null }> {
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.use("/*", createAdapterAuthMiddleware({ adapter: createBuiltinAuthAdapter({ authRepository: closedRepo }), driver: passThroughDriver }));
        app.get("/data", (c) => c.json({ ok: true }));
        const res = await app.request("/data", { headers: { Authorization: `Bearer ${await generateAccessToken("u-1", [])}` } });
        return { status: res.status, code: (await res.json() as { error: { code: string } }).error.code, retryAfter: res.headers.get("Retry-After") };
    }

    it("refuses a signed-in data request with DATABASE_UNAVAILABLE and Retry-After, not ROLE_LOOKUP_FAILED", async () => {
        captureLogs();
        expect(await dataPlane()).toEqual({ status: 503, code: "DATABASE_UNAVAILABLE", retryAfter: "5" });
        expect(await dataPlane()).toEqual({ status: 503, code: "DATABASE_UNAVAILABLE", retryAfter: "5" });

        expect(closedLines()).toHaveLength(1);
        expectNamesTheFix(closedLines()[0], "rebase");
    });

    it("refuses an admin-gated request the same way", async () => {
        captureLogs();
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.use("/*", createRequireAuth({ resolveRoles: async () => { throw closed("rebase"); } }));
        app.get("/admin", (c) => c.json({ ok: true }));
        const res = await app.request("/admin", { headers: { Authorization: `Bearer ${await generateAccessToken("u-1", ["admin"])}` } });

        expect(res.status).toBe(503);
        expect(res.headers.get("Retry-After")).toBe("5");
        expect((await res.json() as { error: { code: string } }).error.code).toBe("DATABASE_UNAVAILABLE");
        expect(closedLines()).toHaveLength(1);
        expectNamesTheFix(closedLines()[0], "rebase");
    });
});
