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
    // Including the exclusion, which is part of that wiring: the stream
    // subscribes before the response is returned, so without it the first thing
    // every reader sees is a log entry about itself connecting.
    app.use("/api/*", logMiddleware({ ignorePaths: ["/api/logs/stream"] }));
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
        expect(await res.json()).toEqual({ entries: [],
total: 0 });
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

/**
 * The tail.
 *
 * `/api/logs/stream` replaced a 3-second poll from the Logs Explorer, so what
 * these cover is the part a poll got for free and a stream has to earn: that the
 * backlog and the live entries arrive on one connection with no gap between
 * them, that the filter means the same thing in both halves, and that a client
 * going away takes its subscription with it.
 */
describe("logs stream", () => {
    beforeEach(() => {
        clearBuffer();
    });

    /**
     * Read SSE frames off a response until `count` have arrived.
     *
     * `cancel: false` leaves the reader attached — cancelling it is itself one of
     * the two ways a disconnect reaches the handler, so a test about the other
     * one has to not do it.
     */
    async function readFrames(
        res: Response,
        count: number,
        { cancel = true }: { cancel?: boolean } = {}
    ): Promise<{ event: string; data: unknown }[]> {
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        const frames: { event: string; data: unknown }[] = [];
        let buffer = "";

        while (frames.length < count) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let boundary = buffer.indexOf("\n\n");
            while (boundary !== -1) {
                const raw = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);
                boundary = buffer.indexOf("\n\n");
                const eventLine = raw.split("\n").find(l => l.startsWith("event: "));
                const dataLine = raw.split("\n").find(l => l.startsWith("data: "));
                if (!dataLine) continue; // a `: ping` comment carries nothing
                frames.push({
                    event: eventLine ? eventLine.slice("event: ".length) : "message",
                    data: JSON.parse(dataLine.slice("data: ".length))
                });
            }
        }
        if (cancel) await reader.cancel();
        return frames;
    }

    it("opens with the current window, oldest first", async () => {
        addLog("info", "system", "first");
        addLog("info", "system", "second");

        const app = buildApp();
        const controller = new AbortController();
        const res = await app.request("/api/logs/stream", { signal: controller.signal });

        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toContain("text/event-stream");
        // Reverse proxies buffer text responses by default, which would hold the
        // whole tail back until something else flushed it.
        expect(res.headers.get("X-Accel-Buffering")).toBe("no");

        const [snapshot] = await readFrames(res, 1);
        controller.abort();

        expect(snapshot.event).toBe("snapshot");
        const body = snapshot.data as { entries: { message: string }[]; total: number };
        expect(body.total).toBe(2);
        // The view appends; both frames are oldest-first so it never has to sort.
        expect(body.entries.map(e => e.message)).toEqual(["first", "second"]);
    });

    it("appends entries logged after the connection opened", async () => {
        const app = buildApp();
        const controller = new AbortController();
        const res = await app.request("/api/logs/stream", { signal: controller.signal });

        const reading = readFrames(res, 2);
        // Ahead of the first flush window, so this lands on the live path rather
        // than in the snapshot.
        await new Promise(resolve => setTimeout(resolve, 50));
        addLog("warn", "auth", "sign-in failed");

        const [snapshot, append] = await reading;
        controller.abort();

        expect((snapshot.data as { entries: unknown[] }).entries).toHaveLength(0);
        expect(append.event).toBe("append");
        const entries = (append.data as { entries: { message: string }[] }).entries;
        expect(entries.map(e => e.message)).toEqual(["sign-in failed"]);
    });

    it("coalesces a burst into one frame", async () => {
        const app = buildApp();
        const controller = new AbortController();
        const res = await app.request("/api/logs/stream", { signal: controller.signal });

        const reading = readFrames(res, 2);
        await new Promise(resolve => setTimeout(resolve, 50));
        for (let i = 0; i < 25; i++) addLog("info", "api", `GET /api/thing ${i}`);

        const [, append] = await reading;
        controller.abort();

        // One frame, not 25: a browser cannot render a re-render per request the
        // server handles, and that is exactly when logs are worth watching.
        expect((append.data as { entries: unknown[] }).entries).toHaveLength(25);
    });

    it("applies the same filter to the backlog and the live entries", async () => {
        addLog("error", "auth", "backlog error");
        addLog("info", "storage", "backlog noise");

        const app = buildApp();
        const controller = new AbortController();
        const res = await app.request("/api/logs/stream?level=error", { signal: controller.signal });

        const reading = readFrames(res, 2);
        await new Promise(resolve => setTimeout(resolve, 50));
        addLog("info", "system", "live noise");
        addLog("error", "system", "live error");

        const [snapshot, append] = await reading;
        controller.abort();

        expect((snapshot.data as { entries: { message: string }[] }).entries.map(e => e.message))
            .toEqual(["backlog error"]);
        expect((append.data as { entries: { message: string }[] }).entries.map(e => e.message))
            .toEqual(["live error"]);
    });

    it("drops its subscription when the client goes away", async () => {
        const app = buildApp();
        const controller = new AbortController();
        const res = await app.request("/api/logs/stream", { signal: controller.signal });

        await readFrames(res, 1, { cancel: false });
        const subscribed = () =>
            (logBuffer as unknown as { listeners: Set<unknown> }).listeners.size;
        expect(subscribed()).toBe(1);

        controller.abort();
        // The loop notices on its next tick; a listener left behind would hold
        // its pending-entry array for the life of the process.
        await new Promise(resolve => setTimeout(resolve, 400));
        expect(subscribed()).toBe(0);
    });

    it("does not record the reader in its own log", async () => {
        const app = new Hono();
        app.use("/api/*", logMiddleware({ ignorePaths: ["/api/logs/stream"] }));
        app.route("/api/logs", logsRoutes);

        const controller = new AbortController();
        const res = await app.request("/api/logs/stream", { signal: controller.signal });
        const [snapshot] = await readFrames(res, 1);
        controller.abort();

        // Not "GET /api/logs/stream 200 0ms": the reader is subscribed by the
        // time the middleware runs, so it would be the first thing it saw.
        expect((snapshot.data as { entries: unknown[] }).entries).toHaveLength(0);
        expect(logBuffer.query({ limit: 100 }).entries).toHaveLength(0);
    });
});
