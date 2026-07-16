import { describe, it, expect, beforeEach } from "@jest/globals";
import { Hono } from "hono";
import logsRoutes, { logMiddleware, addLog, logBuffer } from "../src/api/logs-routes";

/**
 * The Logs Explorer reads `/api/logs`. Both halves of that were dead: the router
 * was never mounted and nothing ever fed the buffer, so the view polled a route
 * that did not exist and rendered "No log entries yet" forever.
 *
 * These tests compose the pieces the way `configureMiddlewares` and `initRebase`
 * now do — record requests through `logMiddleware`, serve them from the router
 * mounted at `/api/logs`.
 */
function buildApp(): Hono {
    const app = new Hono();
    app.use("/api/*", logMiddleware());
    app.get("/api/ping", (c) => c.json({ ok: true }));
    app.route("/api/logs", logsRoutes);
    return app;
}

/** Drain the shared ring buffer so each test starts from a known state. */
function clearBuffer(): void {
    const entries = logBuffer.query({ limit: 100000 }).entries;
    // The buffer is a module-level singleton with no reset; drop what is there
    // by consuming its internal array through the only handle we are given.
    (logBuffer as unknown as { buffer: unknown[] }).buffer = [];
    expect(entries).toBeDefined();
}

describe("logs routes", () => {
    beforeEach(() => {
        clearBuffer();
    });

    it("serves an empty result before anything is logged", async () => {
        const app = buildApp();
        const res = await app.request("/api/logs");

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ entries: [], total: 0 });
    });

    it("records requests that pass through the middleware", async () => {
        const app = buildApp();
        await app.request("/api/ping");

        const res = await app.request("/api/logs");
        const body = await res.json() as { entries: { message: string; source: string; level: string }[] };

        const ping = body.entries.find(e => e.message.includes("/api/ping"));
        expect(ping).toBeDefined();
        expect(ping!.source).toBe("api");
        expect(ping!.level).toBe("info");
        expect(ping!.message).toMatch(/^GET \/api\/ping 200 \d+ms$/);
    });

    it("filters by level, source and search text", async () => {
        addLog("error", "auth", "sign-in failed for user");
        addLog("info", "storage", "uploaded avatar.png");

        const app = buildApp();

        const errors = await (await app.request("/api/logs?level=error")).json() as { entries: unknown[] };
        expect(errors.entries).toHaveLength(1);

        const storage = await (await app.request("/api/logs?source=storage")).json() as { entries: unknown[] };
        expect(storage.entries).toHaveLength(1);

        const search = await (await app.request("/api/logs?search=avatar")).json() as { entries: { message: string }[] };
        expect(search.entries).toHaveLength(1);
        expect(search.entries[0].message).toContain("avatar.png");
    });

    it("returns the newest entries first and honours limit", async () => {
        addLog("info", "system", "first");
        addLog("info", "system", "second");
        addLog("info", "system", "third");

        const app = buildApp();
        const body = await (await app.request("/api/logs?limit=2")).json() as {
            entries: { message: string }[];
            total: number;
        };

        expect(body.total).toBe(3);
        expect(body.entries.map(e => e.message)).toEqual(["third", "second"]);
    });

    it("exposes the latest entries for polling", async () => {
        addLog("info", "system", "recent");

        const app = buildApp();
        const body = await (await app.request("/api/logs/latest?count=1")).json() as {
            entries: { message: string }[];
        };

        expect(body.entries).toHaveLength(1);
        expect(body.entries[0].message).toBe("recent");
    });
});
