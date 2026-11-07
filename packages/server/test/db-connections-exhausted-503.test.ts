import { describe, it, expect, afterEach } from "@jest/globals";
import { Hono } from "hono";
import { errorHandler } from "../src/api/errors";
import { HonoEnv } from "../src/api/types";
import { addLogSink } from "../src/utils/logger";
import { dbConnectionErrorCounts } from "../src/metrics/database";

/**
 * A database server out of connections is load, not a fault.
 *
 * Every app instance opens its own pool against the same `max_connections`,
 * so an autoscaled app tier with no pooler in front of the database runs the
 * server out of slots and the next connect is refused with SQLSTATE 53300
 * ("sorry, too many clients already"). That used to fall through to the
 * generic `[PG 53300]` arm and answer 500 — a crash, to the client, with
 * nothing to back off on. It is now the same shape as an exhausted pool: 503
 * with `Retry-After`, counted on `/metrics`.
 */
describe("a request the database server had no connection for", () => {
    const unsubscribes: Array<() => void> = [];
    afterEach(() => {
        while (unsubscribes.length > 0) unsubscribes.pop()!();
    });

    function pgError(code: string, message: string): Error {
        const inner = Object.assign(new Error(message), { code, severity: "FATAL" });
        return new Error("Failed query: select \"id\" from \"notes\"\nparams: ", { cause: inner });
    }

    function appThrowing(error: unknown) {
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.get("/api/data/notes", () => { throw error; });
        return app;
    }

    it.each([
        ["53300", "sorry, too many clients already"],
        ["53400", "too many connections for role \"rebase\""]
    ])("answers SQLSTATE %s as 503 DB_CONNECTIONS_EXHAUSTED with Retry-After", async (code, message) => {
        const res = await appThrowing(pgError(code, message)).request("/api/data/notes");

        expect(res.status).toBe(503);
        expect(res.headers.get("Retry-After")).toBe("2");
        const body = await res.json() as { error: { code: string; message: string } };
        expect(body.error.code).toBe("DB_CONNECTIONS_EXHAUSTED");
        expect(body.error.message).toMatch(/busy/i);
        expect(body.error.message).not.toContain("select");
    });

    it("counts each one under its SQLSTATE", async () => {
        const before = dbConnectionErrorCounts().get("53300") ?? 0;
        await appThrowing(pgError("53300", "sorry, too many clients already")).request("/api/data/notes");
        await appThrowing(pgError("53300", "sorry, too many clients already")).request("/api/data/notes");
        expect(dbConnectionErrorCounts().get("53300")).toBe(before + 2);
    });

    it("counts an exhausted pool too", async () => {
        const before = dbConnectionErrorCounts().get("pool_exhausted") ?? 0;
        const wrapped = new Error("Failed query: select 1", { cause: new Error("timeout exceeded when trying to connect") });
        await appThrowing(wrapped).request("/api/data/notes");
        expect(dbConnectionErrorCounts().get("pool_exhausted")).toBe(before + 1);
    });

    it("warns at most once a minute, naming what to change, and logs no stack per request", async () => {
        const lines: Array<{ level: string; message: string }> = [];
        unsubscribes.push(addLogSink((level, message) => { lines.push({ level, message }); }));

        for (let i = 0; i < 3; i++) {
            await appThrowing(pgError("53300", "sorry, too many clients already")).request("/api/data/notes");
        }

        const advice = lines.filter(line => /max_connections/.test(line.message));
        expect(advice.length).toBeLessThanOrEqual(1);
        expect(lines.some(line => line.level === "error")).toBe(false);
        expect(lines.some(line => line.message === "unhandled request error")).toBe(false);
    });

    it("leaves a different class-53 error (disk full) a 500", async () => {
        const res = await appThrowing(pgError("53100", "could not extend file")).request("/api/data/notes");
        expect(res.status).toBe(500);
    });
});
