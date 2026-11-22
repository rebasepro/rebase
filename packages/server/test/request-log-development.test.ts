import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { Hono } from "hono";

import type { HonoEnv } from "../src/api/types";
import { ApiError, errorHandler } from "../src/api/errors";
import { requestLogger } from "../src/utils/request-logger";
import { logger } from "../src/utils/logger";

/**
 * The request log in development says what is worth reading.
 *
 * `rebase dev` wrote an INFO line for every request, several per page load, so
 * the ready box and every real warning scrolled out of the terminal within a
 * few clicks. Outside production a routine answer — a success, or a refusal
 * the handler marked expected such as `NO_SESSION` — is logged at debug,
 * where `LOG_LEVEL=debug` still shows it; a failure or a slow request keeps its
 * line. Production keeps an INFO line per request: that is its access log.
 */
function capture() {
    const lines: Array<{ level: string; data?: Record<string, unknown> }> = [];
    for (const level of ["debug", "info", "warn", "error"] as const) {
        jest.spyOn(logger, level).mockImplementation((message: string, data?: Record<string, unknown>) => {
            if (message === "request") lines.push({ level, data });
        });
    }
    return lines;
}

function app(slowRequestMs?: number) {
    const hono = new Hono<HonoEnv>();
    hono.onError(errorHandler);
    hono.use("/*", requestLogger({ skip: [], slowRequestMs }));
    hono.get("/api/auth/config", c => c.json({ ok: true }));
    hono.post("/api/auth/refresh", () => { throw ApiError.unauthenticated("No refresh token presented", "NO_SESSION"); });
    hono.get("/api/data/orders/1", () => { throw ApiError.forbidden("Not your order", "WRITE_DENIED"); });
    hono.get("/api/boom", () => { throw new Error("boom"); });
    return hono;
}

async function levels(hono: Hono<HonoEnv>) {
    const lines = capture();
    await hono.request("/api/auth/config");
    await hono.request("/api/auth/refresh", { method: "POST" });
    await hono.request("/api/data/orders/1");
    await hono.request("/api/boom");
    return lines.map(line => [line.data?.path, line.level]);
}

describe("the request log outside production", () => {
    const original = process.env.NODE_ENV;
    afterEach(() => {
        process.env.NODE_ENV = original;
        jest.restoreAllMocks();
    });

    it("writes routine answers at debug and failures at warn or error", async () => {
        process.env.NODE_ENV = "development";
        expect(await levels(app())).toEqual([
            ["/api/auth/config", "debug"],
            ["/api/auth/refresh", "debug"],
            ["/api/data/orders/1", "warn"],
            ["/api/boom", "error"]
        ]);
    });

    it("writes a slow success at info", async () => {
        process.env.NODE_ENV = "development";
        const lines = capture();
        await app(0).request("/api/auth/config");
        expect(lines.map(line => line.level)).toEqual(["info"]);
    });

    it("keeps an info line per routine request in production", async () => {
        process.env.NODE_ENV = "production";
        expect(await levels(app())).toEqual([
            ["/api/auth/config", "info"],
            ["/api/auth/refresh", "info"],
            ["/api/data/orders/1", "warn"],
            ["/api/boom", "error"]
        ]);
    });
});
