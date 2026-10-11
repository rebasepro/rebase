import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { Hono } from "hono";

import type { HonoEnv } from "../src/api/types";
import { configureMiddlewares } from "../src/init/middlewares";
import { logger } from "../src/utils/logger";

/**
 * The request log skips health probes, as `requestLogger`'s default promised.
 *
 * The default skip list was `["/health"]`, but the logger is mounted at
 * `${basePath}/*`, so the paths it sees all start with the base path: the
 * `/api/health` probe a load balancer sends every few seconds was logged at
 * INFO every time, and `/health` never reached the logger at all.
 */
function requestLines() {
    const lines: Array<Record<string, unknown> | undefined> = [];
    for (const level of ["info", "warn", "error"] as const) {
        jest.spyOn(logger, level).mockImplementation(((message: string, data?: Record<string, unknown>) => {
            if (message === "request") lines.push(data);
        }) as never);
    }
    jest.spyOn(logger, "debug").mockImplementation((() => undefined) as never);
    return lines;
}

function app(basePath: string) {
    const hono = new Hono<HonoEnv>();
    configureMiddlewares(hono, basePath, false, { corsHandled: true });
    hono.get(`${basePath}/health`, c => c.json({ status: "ok" }));
    hono.get(`${basePath}/data/notes`, c => c.json({ data: [] }));
    return hono;
}

describe("the request log and health probes", () => {
    afterEach(() => jest.restoreAllMocks());

    it("does not log GET /api/health", async () => {
        const lines = requestLines();

        const res = await app("/api").request("/api/health");

        expect(res.status).toBe(200);
        expect(lines).toEqual([]);
    });

    it("follows a custom base path", async () => {
        const lines = requestLines();

        await app("/v1").request("/v1/health");

        expect(lines).toEqual([]);
    });

    it("still logs every other request", async () => {
        const lines = requestLines();

        await app("/api").request("/api/data/notes");

        expect(lines).toHaveLength(1);
        expect(lines[0]?.path).toBe("/api/data/notes");
    });
});
