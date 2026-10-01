import { describe, it, expect, afterEach } from "@jest/globals";
import { Hono } from "hono";
import { errorHandler } from "../src/api/errors";
import { HonoEnv } from "../src/api/types";
import { addLogSink } from "../src/utils/logger";
import { createHealthCheck } from "../src/init/health";
import type { DataDriver } from "@rebasepro/types";

/**
 * A full connection pool is an overload, not a bug, and says so.
 *
 * With every pooled connection busy — `DB_POOL_MAX=2` and two requests held on
 * a lock — the next request waits `DB_POOL_CONNECT_TIMEOUT` and pg-pool rejects
 * it with `timeout exceeded when trying to connect`. Drizzle wraps that in
 * `Failed query: …`, the handler found no SQLSTATE, and the caller got
 * `500 INTERNAL_ERROR "Internal Server Error"`: indistinguishable from a crash,
 * nothing to retry on, and nothing in the log naming the pool.
 *
 * It is now `503 DB_POOL_EXHAUSTED` with `Retry-After`, which the SDK already
 * treats as retryable (`offline-connectivity.ts`).
 */
describe("a request that could not get a pooled connection", () => {
    const unsubscribes: Array<() => void> = [];
    afterEach(() => {
        while (unsubscribes.length > 0) unsubscribes.pop()!();
    });

    function wrapped(inner: Error): Error {
        // What drizzle throws: its own wrapper, the pool's error as the cause.
        return new Error("Failed query: select \"id\" from \"notes\"\nparams: ", { cause: inner });
    }

    function appThrowing(error: unknown) {
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.get("/api/data/notes", () => { throw error; });
        return app;
    }

    it("answers 503 DB_POOL_EXHAUSTED with Retry-After", async () => {
        const res = await appThrowing(wrapped(new Error("timeout exceeded when trying to connect"))).request("/api/data/notes");

        expect(res.status).toBe(503);
        expect(res.headers.get("Retry-After")).toBe("1");
        const body = await res.json() as { error: { code: string; message: string } };
        expect(body.error.code).toBe("DB_POOL_EXHAUSTED");
        // The caller learns it is load, not a fault — and still nothing internal.
        expect(body.error.message).toMatch(/busy|connection/i);
        expect(body.error.message).not.toContain("select");
    });

    it("answers a connection that timed out while opening the same way, under its own code", async () => {
        const res = await appThrowing(wrapped(new Error("Connection terminated due to connection timeout"))).request("/api/data/notes");

        expect(res.status).toBe(503);
        expect(res.headers.get("Retry-After")).toBe("1");
        const body = await res.json() as { error: { code: string } };
        expect(body.error.code).toBe("DB_CONNECT_TIMEOUT");
    });

    it("names the pool settings in the log, without a stack trace per request", async () => {
        const lines: Array<{ level: string; message: string }> = [];
        unsubscribes.push(addLogSink((level, message) => { lines.push({ level, message }); }));

        await appThrowing(wrapped(new Error("timeout exceeded when trying to connect"))).request("/api/data/notes");

        expect(lines.some(line => /DB_POOL_MAX/.test(line.message))).toBe(true);
        expect(lines.some(line => line.message === "unhandled request error")).toBe(false);
    });

    it("leaves any other wrapped failure a 500", async () => {
        const res = await appThrowing(wrapped(new Error("something else broke"))).request("/api/data/notes");
        expect(res.status).toBe(500);
        expect(res.headers.get("Retry-After")).toBeNull();
    });
});

describe("the health check, when the pool is exhausted", () => {
    it("reports the cause, not the redacted wrapper", async () => {
        const driver = {
            admin: {
                executeSql: async () => {
                    throw new Error("Failed query: SELECT 1\nparams: ", {
                        cause: new Error("timeout exceeded when trying to connect")
                    });
                }
            }
        } as unknown as DataDriver;

        const result = await createHealthCheck(driver)();
        expect(result.healthy).toBe(false);
        expect(String(result.details?.error)).toContain("timeout exceeded when trying to connect");
        expect(String(result.details?.error)).not.toContain("SELECT 1");
    });
});
