import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { Hono } from "hono";

import { ApiError, errorHandler } from "../src/api/errors";
import type { HonoEnv } from "../src/api/types";
import { requestLogger } from "../src/utils/request-logger";
import { logger } from "../src/utils/logger";

/**
 * One log line per failed request, carrying the user and the collection.
 *
 * A failure used to produce two, each holding half of it. The error handler had
 * the code and the diagnosis and nothing about who asked; `requestLogger` had
 * the user, the status and the latency and nothing about what went wrong.
 * Correlating them meant matching on the request id, and the pair cost twice
 * the volume for less than one line's worth of meaning.
 *
 * The handler now leaves its half on the context and stays quiet wherever a
 * request line is coming. Wherever one is not — a router mounted onto a
 * project's own Hono app — it still speaks, because silence is the one outcome
 * neither half may produce.
 */
function capture() {
    const lines: Array<{ level: string; message: string; data?: Record<string, unknown> }> = [];
    for (const level of ["debug", "info", "warn", "error"] as const) {
        jest.spyOn(logger, level).mockImplementation(((message: string, data?: Record<string, unknown>) => {
            lines.push({ level, message, data });
        }) as never);
    }
    return lines;
}

function appWithLogger() {
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.use("/*", requestLogger({ skip: [] }));
    app.use("/*", async (c, next) => {
        c.set("user", { uid: "user-42" });
        c.set("collection", "orders");
        await next();
    });
    app.get("/orders/1", () => { throw ApiError.forbidden("Not your order", "WRITE_DENIED"); });
    return app;
}

describe("a failed request logs once", () => {
    afterEach(() => jest.restoreAllMocks());

    it("writes exactly one line, carrying uid, collection and the error code", async () => {
        const lines = capture();

        const res = await appWithLogger().request("/orders/1");

        expect(res.status).toBe(403);
        const about = lines.filter(line => line.message === "request"
            || String(line.message).includes("[API]"));
        expect(about).toHaveLength(1);

        const [only] = about;
        expect(only.message).toBe("request");
        expect(only.data).toMatchObject({
            status: 403,
            uid: "user-42",
            collection: "orders",
            errorCode: "WRITE_DENIED",
            errorMessage: "Not your order"
        });
    });

    it("still writes the handler's own line when nothing else will", async () => {
        // A project that mounts routes onto its own Hono app installs no
        // request logger. Suppressing here would lose the failure entirely.
        const lines = capture();

        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.get("/boom", () => { throw ApiError.forbidden("Nope", "FORBIDDEN"); });

        await app.request("/boom");

        expect(lines.map(line => line.message).join("\n")).toContain("[API]");
    });

    it("keeps a successful request to one line as well", async () => {
        const lines = capture();

        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.use("/*", requestLogger({ skip: [] }));
        app.get("/ok", (c) => c.json({ ok: true }));

        await app.request("/ok");

        expect(lines.filter(line => line.message === "request")).toHaveLength(1);
        expect(lines[0].data).not.toHaveProperty("errorCode");
    });
});
