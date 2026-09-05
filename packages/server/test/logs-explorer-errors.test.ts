import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { Hono } from "hono";

import { ApiError, errorHandler } from "../src/api/errors";
import { logBuffer, logMiddleware, sourceForMessage, teeLoggerIntoLogBuffer } from "../src/api/logs-routes";
import { requestLogger } from "../src/utils/request-logger";
import { logger } from "../src/utils/logger";
import type { HonoEnv } from "../src/api/types";

/**
 * The Logs Explorer can show you an error.
 *
 * Its ring buffer was filled by one request middleware and nothing else, so the
 * panel rendered a wall of `GET /api/data/posts 200 4ms` — every entry at
 * `info`, whatever the request answered — while every error, warning and boot
 * diagnosis the server wrote went to a terminal the person looking at the panel
 * does not have. The sharpest case is a custom function that throws: the entry
 * said 500 and the reason existed nowhere the panel could reach.
 */
describe("the Logs Explorer ring", () => {
    let detach: (() => void) | undefined;

    beforeEach(() => {
        detach = teeLoggerIntoLogBuffer();
        // Nothing drains the ring — `LogRingBuffer` has no clear() — and this
        // used to pretend otherwise with a `query(...).entries.length` whose
        // value went nowhere. It is not needed: every assertion below reads
        // `latest(n)`, the newest entries first, so a previous suite's lines are
        // behind the ones under test rather than mixed in with them.
    });

    afterEach(() => {
        detach?.();
        detach = undefined;
    });

    /** The newest entries, newest first. */
    const latest = (count = 20) => logBuffer.getLatest(count);

    it("records a warning the server wrote, not only requests", () => {
        logger.warn("[Auth] Could not resolve roles for an admin-gated request");

        const entry = latest().find(e => e.message.includes("Could not resolve roles"));
        expect(entry).toBeDefined();
        expect(entry!.level).toBe("warn");
        expect(entry!.source).toBe("auth");
    });

    it("ignores the steady-state chatter at info", () => {
        // A 10,000-entry ring filled with routine info evicts the lines
        // somebody opened the panel to find.
        logger.info("[schema] Collection schema is up to date.");
        expect(latest().some(e => e.message.includes("up to date"))).toBe(false);
    });

    it("shows a function's own error message against the request", async () => {
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.use("/*", requestLogger({ skip: [] }));
        app.use("/*", logMiddleware());
        app.get("/api/fn/charge", () => {
            throw ApiError.badRequest("Stripe rejected the card: insufficient_funds", "INVALID_INPUT");
        });

        await app.request("/api/fn/charge");

        const entry = latest().find(e => e.message.includes("/api/fn/charge"));
        expect(entry).toBeDefined();
        // The level, so the panel's filter can find it at all.
        expect(entry!.level).toBe("warn");
        expect(entry!.message).toContain("insufficient_funds");
        expect(entry!.metadata).toMatchObject({
            status: 400,
            errorCode: "INVALID_INPUT",
            errorMessage: "Stripe rejected the card: insufficient_funds"
        });
    });

    it("does not record the same failure twice", () => {
        // `requestLogger` writes its line to stdout as `request`, and
        // `logMiddleware` has already recorded the same request here with the
        // fields this panel renders.
        const before = latest(200).length;
        logger.error("request", { method: "GET", path: "/api/data/posts", status: 500 });
        expect(latest(200).length).toBe(before);
    });

    it("survives a sink that would otherwise recurse", () => {
        // A sink is called from inside `emit`; anything that comes back through
        // `logger` would recurse until the stack gives out.
        expect(() => logger.error("[API] boom")).not.toThrow();
    });
});

describe("sourceForMessage", () => {
    it("reads the bracketed prefix, wherever the level emoji left it", () => {
        expect(sourceForMessage("⚠️ [API] GET /x → 500")).toBe("api");
        expect(sourceForMessage("[Auth] token rejected")).toBe("auth");
        expect(sourceForMessage("[storage] upload refused")).toBe("storage");
        expect(sourceForMessage("[realtime] subscriber dropped")).toBe("realtime");
    });

    it("falls back to system rather than guessing", () => {
        expect(sourceForMessage("Failed to start the Rebase runtime")).toBe("system");
        expect(sourceForMessage("[schema] could not add foreign key")).toBe("system");
    });
});
