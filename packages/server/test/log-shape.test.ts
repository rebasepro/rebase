import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Hono } from "hono";

import type { HonoEnv } from "../src/api/types";
import { logger, shapeMessage } from "../src/utils/logger";
import { requestId } from "../src/utils/request-id";
import { requestLogContext } from "../src/utils/request-log-context";
import { requestLogger } from "../src/utils/request-logger";

/**
 * The shape every production line has, whoever wrote it.
 *
 * A line names its subsystem in `component`, never in a `[Tag]` or a pictograph
 * at the head of its text; a field cannot overwrite the line's own keys; a line
 * written while a request runs carries that request's id; and the request line
 * says which route answered, so lines can be counted per endpoint.
 */

describe("shapeMessage", () => {
    it("moves a leading tag into the component and drops the pictographs", () => {
        expect(shapeMessage("📡 [ChannelBus] Cross-instance channels active")).toEqual({
            message: "Cross-instance channels active",
            component: "channelbus",
        });
        expect(shapeMessage("ℹ️ [CDC] Changes cannot be streamed")).toEqual({ message: "Changes cannot be streamed", component: "cdc" });
        expect(shapeMessage("✅ [cron] \"x\" completed")).toEqual({ message: "\"x\" completed", component: "cron" });
        expect(shapeMessage("[WebSocket Server] Socket opened")).toEqual({ message: "Socket opened", component: "websocket" });
    });

    it("drops pictographs with no tag, and the product's own name as a tag", () => {
        expect(shapeMessage("🔐 RLS enforcement active")).toEqual({ message: "RLS enforcement active", component: null });
        expect(shapeMessage("✅ Cron logs table ready")).toEqual({ message: "Cron logs table ready", component: null });
        expect(shapeMessage("[Rebase] Refused a request")).toEqual({ message: "Refused a request", component: null });
    });

    it("leaves a sentence that merely contains brackets or emoji alone", () => {
        expect(shapeMessage("Loaded 3 [optional] plugins 🎉")).toEqual({ message: "Loaded 3 [optional] plugins 🎉", component: null });
        expect(shapeMessage("request")).toEqual({ message: "request", component: null });
    });

    it("drops a list bullet from a continuation line", () => {
        expect(shapeMessage("   • voice_cache: \"wav\" is nullable")).toEqual({ message: "voice_cache: \"wav\" is nullable", component: null });
    });

    it("never shapes a line down to nothing", () => {
        expect(shapeMessage("[cron]")).toEqual({ message: "[cron]", component: null });
    });
});

describe("a production line", () => {
    const originalEnv = process.env.NODE_ENV;
    let stdout: string[];

    beforeEach(() => {
        process.env.NODE_ENV = "production";
        stdout = [];
        jest.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => { stdout.push(String(chunk)); return true; });
        jest.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => { stdout.push(String(chunk)); return true; });
    });

    afterEach(() => {
        jest.restoreAllMocks();
        if (originalEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = originalEnv;
    });

    const lines = (): Array<Record<string, unknown>> => stdout
        .flatMap((chunk) => chunk.split("\n").filter(Boolean))
        .map((line) => JSON.parse(line) as Record<string, unknown>);

    it("carries the tag as a component field", () => {
        logger.info("⏰ [cron] Scheduler started", { jobs: 7 });
        expect(lines()).toEqual([expect.objectContaining({ severity: "INFO", message: "Scheduler started", component: "cron", jobs: 7 })]);
    });

    it("lets an explicit component win over the tag", () => {
        logger.warn("[CDC] Falling back", { component: "realtime" });
        expect(lines()[0]).toMatchObject({ message: "Falling back", component: "realtime" });
    });

    it("keeps a field named like the line's own keys beside them, not over them", () => {
        logger.info("saved", { message: "user text", severity: "low", timestamp: 1 });
        expect(lines()[0]).toMatchObject({ severity: "INFO", message: "saved", data_message: "user text", data_severity: "low", data_timestamp: 1 });
        expect(typeof lines()[0].timestamp).toBe("string");
    });

    it("carries the request's id and caller on every line written while it runs", async () => {
        const app = new Hono<HonoEnv>();
        app.use("/*", requestId());
        app.use("/*", requestLogContext());
        app.use("/*", requestLogger({ skip: [] }));
        app.use("/*", async (c, next) => { c.set("user", { uid: "user-42" }); await next(); });
        app.get("/api/data/:table/:id", (c) => {
            logger.info("looked it up", { table: c.req.param("table") });
            return c.json({ ok: true });
        });

        const res = await app.request("/api/data/rooms/RCTF");
        const id = res.headers.get("X-Request-ID");

        const handlerLine = lines().find((l) => l.message === "looked it up");
        const requestLine = lines().find((l) => l.message === "request");
        expect(handlerLine).toMatchObject({ requestId: id, uid: "user-42", table: "rooms" });
        expect(requestLine).toMatchObject({
            component: "http",
            requestId: id,
            path: "/api/data/rooms/RCTF",
            route: "/api/data/:table/:id",
            status: 200,
        });
    });

    it("leaves the route out when only a catch-all answered", async () => {
        const app = new Hono<HonoEnv>();
        app.use("/*", requestLogger({ skip: [] }));
        app.all("/*", (c) => c.text("spa"));

        await app.request("/some/page");

        const requestLine = lines().find((l) => l.message === "request");
        expect(requestLine).toBeDefined();
        expect(requestLine).not.toHaveProperty("route");
    });

    it("carries no request fields outside a request", () => {
        logger.info("idle");
        expect(lines()[0]).not.toHaveProperty("requestId");
    });
});
