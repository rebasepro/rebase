import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { Hono } from "hono";
import { createLogsRoutes, logMiddleware, addLog, logBuffer } from "../src/api/logs-routes";
import type { LogEntry, LogStreamTiming } from "../src/api/logs-routes";

/**
 * What the tail does under conditions nobody arranges on purpose.
 *
 * `logs-routes.test.ts` covers the contract. This covers the ways a long-lived
 * push connection fails that a request/response route cannot: a keepalive that
 * stops firing, a burst larger than the server will hold, a log message that
 * looks like an SSE frame, twenty-five readers at once, and a client that
 * disappears at the wrong moment. Every one of these is silent in production —
 * the symptom is a log view that looks fine and is missing things.
 */

/** Fast timings so a keepalive is observable in milliseconds, not half a minute. */
const FAST: LogStreamTiming = { flushMs: 20,
    heartbeatMs: 60 };

function buildApp(timing: LogStreamTiming = FAST): Hono {
    const app = new Hono();
    app.use("/api/*", logMiddleware({ ignorePaths: ["/api/logs/stream"] }));
    app.get("/api/ping", (c) => c.json({ ok: true }));
    app.route("/api/logs", createLogsRoutes(timing));
    return app;
}

function clearBuffer(): void {
    (logBuffer as unknown as { buffer: unknown[] }).buffer = [];
}

const listenerCount = (): number =>
    (logBuffer as unknown as { listeners: Set<unknown> }).listeners.size;

interface Frame {
    event: string;
    data: unknown;
}

/**
 * An open SSE connection, read incrementally.
 *
 * Frames and raw text both, because some of what matters here is not a frame: a
 * `: ping` comment carries no data and would vanish from a frames-only view,
 * which is exactly how a rotted keepalive stays invisible.
 */
class Tail {
    private reader: ReadableStreamDefaultReader<Uint8Array>;
    private decoder = new TextDecoder();
    private pendingText = "";
    private ended = false;
    /**
     * The read that has been started but not yet resolved.
     *
     * Held across calls, and that is the whole point. `Promise.race`-ing a fresh
     * `reader.read()` against a timeout orphans the read when the timeout wins —
     * it still resolves later, with a chunk nobody is holding, and the bytes are
     * simply gone. That reads as the server having sent nothing, which is
     * indistinguishable from the bug these tests are looking for.
     */
    private inFlight: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;
    readonly raw: string[] = [];
    readonly frames: Frame[] = [];

    constructor(res: Response, readonly controller: AbortController) {
        this.reader = res.body!.getReader();
    }

    /** Pump until `predicate` holds or `timeoutMs` elapses. Returns whether it held. */
    async until(predicate: () => boolean, timeoutMs = 2000): Promise<boolean> {
        const deadline = Date.now() + timeoutMs;
        while (!predicate() && Date.now() < deadline && !this.ended) {
            if (!this.inFlight) this.inFlight = this.reader.read();
            let timer: ReturnType<typeof setTimeout> | undefined;
            const settled = await Promise.race([
                this.inFlight.then(result => ({ result })).catch(() => ({ result: null })),
                new Promise<null>(resolve => {
                    timer = setTimeout(() => resolve(null), 25);
                })
            ]);
            clearTimeout(timer);
            if (settled === null) continue; // still pending — keep the same read
            this.inFlight = null;
            if (settled.result === null || settled.result.done) {
                this.ended = true;
                break;
            }
            this.ingest(this.decoder.decode(settled.result.value, { stream: true }));
        }
        return predicate();
    }

    /** Pump for a fixed window, to catch what should *not* arrive. */
    drain(ms: number): Promise<boolean> {
        return this.until(() => false, ms);
    }

    private ingest(chunk: string): void {
        this.raw.push(chunk);
        this.pendingText += chunk;
        let boundary = this.pendingText.indexOf("\n\n");
        while (boundary !== -1) {
            const block = this.pendingText.slice(0, boundary);
            this.pendingText = this.pendingText.slice(boundary + 2);
            boundary = this.pendingText.indexOf("\n\n");

            const lines = block.split("\n");
            const dataLines = lines.filter(l => l.startsWith("data: ")).map(l => l.slice(6));
            if (dataLines.length === 0) continue; // comment-only block
            const eventLine = lines.find(l => l.startsWith("event: "));
            this.frames.push({
                event: eventLine ? eventLine.slice(7) : "message",
                data: JSON.parse(dataLines.join("\n"))
            });
        }
    }

    get text(): string {
        return this.raw.join("");
    }

    entriesOf(event: string): LogEntry[] {
        return this.frames
            .filter(f => f.event === event)
            .flatMap(f => (f.data as { entries: LogEntry[] }).entries);
    }

    /** Close it the way a browser tab closing does. */
    close(): void {
        this.controller.abort();
    }
}

/** Every tail opened by the current test, so `afterEach` can prove they all went. */
const opened: Tail[] = [];

async function openTail(app: Hono, url = "/api/logs/stream"): Promise<Tail> {
    const controller = new AbortController();
    const res = await app.request(url, { signal: controller.signal });
    expect(res.status).toBe(200);
    const tail = new Tail(res, controller);
    opened.push(tail);
    return tail;
}

/** Let the flush loop notice a closed connection and run its `finally`. */
const settle = (ms = 150) => new Promise(resolve => setTimeout(resolve, ms));

async function waitForListeners(count: number, timeoutMs = 2000): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    while (listenerCount() !== count && Date.now() < deadline) await settle(20);
    return listenerCount();
}

/**
 * Close every tail and prove the server forgot it.
 *
 * On every test, not just the one about leaks. The subscriber set is a
 * module-level singleton, so one handler that fails to unsubscribe both leaks in
 * production and silently corrupts the counts every later test reads — the second
 * of which is how the first stays hidden.
 */
afterEach(async () => {
    opened.forEach(t => t.close());
    const remaining = await waitForListeners(0);
    opened.length = 0;
    expect(remaining).toBe(0);
});

describe("log stream keepalive", () => {
    beforeEach(clearBuffer);

    it("sends a comment when there is nothing to say", async () => {
        const tail = await openTail(buildApp());
        // Nothing is logged: an idle server is the normal state, and a silent
        // socket is what proxies and load balancers reap.
        const pinged = await tail.until(() => tail.text.includes(": ping"));
        tail.close();

        expect(pinged).toBe(true);
    });

    it("keeps pinging, rather than once and never again", async () => {
        const tail = await openTail(buildApp());
        const pings = () => tail.text.split(": ping").length - 1;
        const twice = await tail.until(() => pings() >= 2, 3000);
        tail.close();

        expect(twice).toBe(true);
    });

    /**
     * Traffic has to *reset* the idle timer, not merely outpace it.
     *
     * So this runs for several times the heartbeat window — long enough that a
     * timer which only accumulated on quiet ticks and never reset on a flush would
     * cross the threshold and ping. A shorter run proves only that the window is
     * wider than the run, which is not the same claim and is what an earlier
     * version of this test was actually checking.
     */
    it("does not ping while entries are flowing", async () => {
        const HEARTBEAT = 100;
        const app = buildApp({ flushMs: 20,
            heartbeatMs: HEARTBEAT });
        const tail = await openTail(app);
        await tail.until(() => tail.frames.length >= 1);

        const started = Date.now();
        let logged = 0;
        // Gaps of 30ms: never five quiet ticks in a row, so a timer that resets on
        // every flush can never reach 100ms.
        while (Date.now() - started < HEARTBEAT * 6) {
            addLog("info", "api", `busy ${logged++}`);
            // `drain`, not a bare sleep: the reader has to be pumped throughout or
            // the frames pile up unread and the assertions below see nothing.
            await tail.drain(30);
        }

        expect(tail.text).not.toContain(": ping");
        expect(tail.entriesOf("append")).toHaveLength(logged);
    });
});

describe("log stream backpressure", () => {
    beforeEach(clearBuffer);

    it("caps what it holds and reports the hole it left", async () => {
        // A burst inside one tick cannot be flushed part-way through, so it is the
        // honest shape of "more than this connection can hold".
        const app = buildApp({ flushMs: 30,
            heartbeatMs: 10_000,
            maxPending: 5 });
        const tail = await openTail(app);
        await tail.until(() => tail.frames.length >= 1);

        for (let i = 0; i < 40; i++) addLog("info", "api", `burst ${i}`);

        await tail.until(() => tail.frames.some(f => f.event === "append"));
        tail.close();

        const append = tail.frames.find(f => f.event === "append")!.data as {
            entries: LogEntry[];
            dropped?: number;
        };
        expect(append.entries).toHaveLength(5);
        expect(append.dropped).toBe(35);
        // The newest survive: a tail that drops the recent end shows the past and
        // calls it the present.
        expect(append.entries.map(e => e.message)).toEqual([
            "burst 35", "burst 36", "burst 37", "burst 38", "burst 39"
        ]);
    });

    /**
     * The cap is a rate ceiling, and it has to sit above real traffic.
     *
     * Nothing drains `pending` between flushes, so a connection carries at most
     * `maxPending` per `flushMs` however fast the client reads. With the two set
     * carelessly that fires in ordinary conditions: at 500 per 250ms a reader on a
     * loopback socket lost 85% of a 20k burst, and the drop notice blamed a client
     * that was keeping up perfectly.
     */
    it("loses nothing to the cap at a rate the defaults are meant to carry", async () => {
        // The shipped ratio, an order of magnitude faster: 2000 per 250ms is 8000
        // entries a second, so 40 per 5ms must pass untouched.
        const app = buildApp({ flushMs: 5,
            heartbeatMs: 10_000,
            maxPending: 40 });
        const tail = await openTail(app);
        await tail.until(() => tail.frames.length >= 1);

        const TOTAL = 400;
        for (let i = 0; i < TOTAL; i += 10) {
            for (let j = 0; j < 10; j++) addLog("info", "api", `paced ${i + j}`);
            await tail.drain(5);
        }
        await tail.until(() => tail.entriesOf("append").length >= TOTAL, 3000);

        expect(tail.entriesOf("append")).toHaveLength(TOTAL);
        const dropped = tail.frames
            .filter(f => f.event === "append")
            .reduce((sum, f) => sum + ((f.data as { dropped?: number }).dropped ?? 0), 0);
        expect(dropped).toBe(0);
    });

    it("omits the count entirely when nothing was dropped", async () => {
        const app = buildApp({ flushMs: 20,
            heartbeatMs: 10_000,
            maxPending: 100 });
        const tail = await openTail(app);
        await tail.until(() => tail.frames.length >= 1);

        addLog("info", "api", "well within the cap");
        await tail.until(() => tail.frames.length >= 2);
        tail.close();

        const append = tail.frames[1].data as Record<string, unknown>;
        expect(append).not.toHaveProperty("dropped");
    });

    it("stops dropping once the reader catches up", async () => {
        const app = buildApp({ flushMs: 20,
            heartbeatMs: 10_000,
            maxPending: 3 });
        const tail = await openTail(app);
        await tail.until(() => tail.frames.length >= 1);

        for (let i = 0; i < 10; i++) addLog("info", "api", `overflow ${i}`);
        await tail.until(() => tail.frames.length >= 2);

        addLog("info", "api", "calm");
        await tail.until(() => tail.entriesOf("append").some(e => e.message === "calm"));
        tail.close();

        const frames = tail.frames.filter(f => f.event === "append");
        const last = frames[frames.length - 1].data as { dropped?: number };
        expect(last.dropped).toBeUndefined();
    });
});

describe("log stream framing", () => {
    beforeEach(clearBuffer);

    /**
     * Log messages contain request paths, and a path is whatever the caller sent.
     * If a message could end a frame or start a new one, anyone able to make a
     * request could forge log entries in an admin's view — so this is a boundary,
     * not a formatting nicety. JSON encoding is what holds it; this proves it
     * holds rather than assuming it.
     */
    it("survives a message that looks like an SSE frame", async () => {
        const app = buildApp({ flushMs: 20,
            heartbeatMs: 10_000 });
        const tail = await openTail(app);
        await tail.until(() => tail.frames.length >= 1);

        const forged = "GET /x\n\nevent: error\ndata: \"you have been pwned\"\n\n 200 1ms";
        addLog("info", "api", forged);
        await tail.until(() => tail.entriesOf("append").length >= 1);
        tail.close();

        const entries = tail.entriesOf("append");
        expect(entries).toHaveLength(1);
        expect(entries[0].message).toBe(forged);
        // One frame, and no injected `error` event anywhere.
        expect(tail.frames.filter(f => f.event === "error")).toHaveLength(0);
    });

    it("carries multi-byte text through intact", async () => {
        const app = buildApp({ flushMs: 20,
            heartbeatMs: 10_000 });
        const tail = await openTail(app);
        await tail.until(() => tail.frames.length >= 1);

        const message = "GET /café/日本語/🚀 200 1ms";
        addLog("info", "api", message);
        await tail.until(() => tail.entriesOf("append").length >= 1);
        tail.close();

        expect(tail.entriesOf("append")[0].message).toBe(message);
    });

    it("keeps a carriage return from splitting a frame", async () => {
        const app = buildApp({ flushMs: 20,
            heartbeatMs: 10_000 });
        const tail = await openTail(app);
        await tail.until(() => tail.frames.length >= 1);

        addLog("info", "api", "line one\r\nline two\rline three");
        await tail.until(() => tail.entriesOf("append").length >= 1);
        tail.close();

        expect(tail.entriesOf("append")).toHaveLength(1);
        expect(tail.entriesOf("append")[0].message).toBe("line one\r\nline two\rline three");
    });
});

describe("log stream under load", () => {
    beforeEach(clearBuffer);

    it("delivers a large burst exactly once, in order", async () => {
        const COUNT = 5000;
        const app = buildApp({ flushMs: 20,
            heartbeatMs: 10_000,
            maxPending: COUNT * 2 });
        const tail = await openTail(app);
        await tail.until(() => tail.frames.length >= 1);

        for (let i = 0; i < COUNT; i++) addLog("info", "api", `load ${i}`);

        const arrived = await tail.until(() => tail.entriesOf("append").length >= COUNT, 5000);
        tail.close();

        expect(arrived).toBe(true);
        const entries = tail.entriesOf("append");
        expect(entries).toHaveLength(COUNT);
        expect(new Set(entries.map(e => e.id)).size).toBe(COUNT);
        expect(entries.map(e => e.message)).toEqual(
            Array.from({ length: COUNT }, (_, i) => `load ${i}`)
        );
        // Coalesced, not one frame per entry — the whole reason the flush window
        // exists. 5000 frames would be 5000 client re-renders.
        expect(tail.frames.length).toBeLessThan(COUNT / 10);
    });

    it("leaves no gap between the snapshot and the first append", async () => {
        // Comfortably inside the cap, so a gap here can only be the handshake
        // race and not the drop path (which is covered above, and which has to be
        // ruled out for "no gap" to mean anything).
        const TOTAL = 400;
        const app = buildApp({ flushMs: 20,
            heartbeatMs: 10_000,
            maxPending: 10_000 });

        // Log continuously across the handshake, so anything logged between
        // "read the backlog" and "subscribe" would fall down the crack a
        // two-request client has.
        let written = 0;
        let writing = true;
        const writer = (async () => {
            while (writing && written < TOTAL) {
                addLog("info", "api", `race ${written++}`);
                await new Promise(resolve => setImmediate(resolve));
            }
        })();

        const tail = await openTail(app);
        await tail.until(() => tail.frames.filter(f => f.event === "append").length >= 2);
        writing = false;
        await writer;
        await tail.drain(300); // let what is still in flight arrive

        const seen = [...tail.entriesOf("snapshot"), ...tail.entriesOf("append")]
            .map(e => Number(e.id.slice("log_".length)));

        expect(seen.length).toBeGreaterThan(20);
        expect(new Set(seen).size).toBe(seen.length); // no entry twice
        for (let i = 1; i < seen.length; i++) {
            // Contiguous: every id between the first and last is accounted for.
            expect(seen[i]).toBe(seen[i - 1] + 1);
        }
    });

    it("serves twenty-five readers at once, and forgets all of them", async () => {
        const app = buildApp({ flushMs: 20,
            heartbeatMs: 10_000,
            maxPending: 1000 });
        const tails = await Promise.all(
            Array.from({ length: 25 }, () => openTail(app))
        );
        await Promise.all(tails.map(t => t.until(() => t.frames.length >= 1)));
        expect(listenerCount()).toBe(25);

        addLog("warn", "auth", "everyone should see this");
        await Promise.all(tails.map(t => t.until(() => t.entriesOf("append").length >= 1)));

        for (const t of tails) {
            expect(t.entriesOf("append").map(e => e.message)).toEqual(["everyone should see this"]);
        }

        // A listener left behind holds its pending array for the life of the
        // process, and nothing in a log would ever say so. `afterEach` closes
        // these and asserts the set drained.
    });

    it("leaks nothing across many connect/disconnect cycles", async () => {
        const app = buildApp({ flushMs: 20,
            heartbeatMs: 10_000 });
        for (let i = 0; i < 30; i++) {
            const tail = await openTail(app);
            await tail.until(() => tail.frames.length >= 1);
            tail.close();
            // Drained each cycle rather than all at the end: a handler that
            // unsubscribes only when the *last* reader goes would pass the
            // batched version of this.
            expect(await waitForListeners(0)).toBe(0);
        }
    });
});

describe("log stream filtering", () => {
    beforeEach(clearBuffer);

    it("gives two readers with different filters different logs", async () => {
        const app = buildApp({ flushMs: 20,
            heartbeatMs: 10_000 });
        const errors = await openTail(app, "/api/logs/stream?level=error");
        const storage = await openTail(app, "/api/logs/stream?source=storage");
        await errors.until(() => errors.frames.length >= 1);
        await storage.until(() => storage.frames.length >= 1);

        addLog("error", "auth", "an error");
        addLog("info", "storage", "an upload");

        await errors.until(() => errors.entriesOf("append").length >= 1);
        await storage.until(() => storage.entriesOf("append").length >= 1);
        errors.close();
        storage.close();

        expect(errors.entriesOf("append").map(e => e.message)).toEqual(["an error"]);
        expect(storage.entriesOf("append").map(e => e.message)).toEqual(["an upload"]);
    });

    it("matches search case-insensitively, live as well as in the backlog", async () => {
        addLog("info", "storage", "Uploaded AVATAR.png");
        const app = buildApp({ flushMs: 20,
            heartbeatMs: 10_000 });
        const tail = await openTail(app, "/api/logs/stream?search=avatar");
        await tail.until(() => tail.frames.length >= 1);

        addLog("info", "storage", "deleted Avatar.jpeg");
        addLog("info", "storage", "unrelated file");
        await tail.until(() => tail.entriesOf("append").length >= 1);
        tail.close();

        expect(tail.entriesOf("snapshot").map(e => e.message)).toEqual(["Uploaded AVATAR.png"]);
        expect(tail.entriesOf("append").map(e => e.message)).toEqual(["deleted Avatar.jpeg"]);
    });

    it("applies every filter at once", async () => {
        addLog("error", "auth", "sign-in failed: token expired");
        addLog("error", "storage", "sign-in failed: wrong source");
        addLog("info", "auth", "sign-in failed: wrong level");
        addLog("error", "auth", "something else entirely");

        const app = buildApp({ flushMs: 20,
            heartbeatMs: 10_000 });
        const tail = await openTail(app, "/api/logs/stream?level=error&source=auth&search=sign-in");
        await tail.until(() => tail.frames.length >= 1);
        tail.close();

        expect(tail.entriesOf("snapshot").map(e => e.message))
            .toEqual(["sign-in failed: token expired"]);
    });

    it("honours limit on the opening window", async () => {
        for (let i = 0; i < 20; i++) addLog("info", "system", `entry ${i}`);

        const app = buildApp({ flushMs: 20,
            heartbeatMs: 10_000 });
        const tail = await openTail(app, "/api/logs/stream?limit=3");
        await tail.until(() => tail.frames.length >= 1);
        tail.close();

        const snapshot = tail.frames[0].data as { entries: LogEntry[]; total: number };
        // The most recent three, still oldest-first, with `total` describing the
        // whole match so the view can say what it is not showing.
        expect(snapshot.entries.map(e => e.message)).toEqual(["entry 17", "entry 18", "entry 19"]);
        expect(snapshot.total).toBe(20);
    });
});

describe("log stream disconnects", () => {
    beforeEach(clearBuffer);

    /**
     * The one that was broken.
     *
     * A listener added to an already-aborted `AbortSignal` is never called, so a
     * client that vanished during the snapshot write left the handler with no way
     * to learn it had gone: one leaked subscriber and one 250ms loop, forever, per
     * attempt. A browser reload loop or a reconnect storm against a restarting
     * server is exactly the shape that produces it, at volume, and nothing in any
     * log says a word about it.
     */
    it("survives a client that leaves before reading a byte", async () => {
        const app = buildApp({ flushMs: 20,
            heartbeatMs: 10_000 });
        const controller = new AbortController();
        // Aborted before the handler gets as far as registering its listener.
        controller.abort();
        const res = await app.request("/api/logs/stream", { signal: controller.signal });
        void res;

        expect(await waitForListeners(0)).toBe(0);
        // And the server is still serving.
        expect((await app.request("/api/logs")).status).toBe(200);
    });

    it("survives a client that leaves mid-handshake", async () => {
        const app = buildApp({ flushMs: 20,
            heartbeatMs: 10_000 });
        for (let i = 0; i < 20; i++) {
            const controller = new AbortController();
            const res = await app.request("/api/logs/stream", { signal: controller.signal });
            // No await between: the abort lands while the snapshot write is still
            // in flight, which is the window a reconnect storm sits in.
            controller.abort();
            void res;
        }
        expect(await waitForListeners(0)).toBe(0);
    });

    it("keeps other readers alive when one leaves", async () => {
        const app = buildApp({ flushMs: 20,
            heartbeatMs: 10_000 });
        const staying = await openTail(app);
        const leaving = await openTail(app);
        await staying.until(() => staying.frames.length >= 1);
        await leaving.until(() => leaving.frames.length >= 1);

        leaving.close();
        await settle(150);

        addLog("info", "system", "after the other one left");
        const got = await staying.until(() => staying.entriesOf("append").length >= 1);
        staying.close();

        expect(got).toBe(true);
        expect(staying.entriesOf("append").map(e => e.message)).toEqual(["after the other one left"]);
    });

    it("does not record its own readers in the log it serves", async () => {
        const app = buildApp({ flushMs: 20,
            heartbeatMs: 10_000 });
        const tail = await openTail(app);
        await tail.until(() => tail.frames.length >= 1);

        // A reconnect loop against a restarting server opens this repeatedly; each
        // one recorded would be an entry about the act of reading.
        for (let i = 0; i < 5; i++) {
            const extra = await openTail(app);
            await extra.until(() => extra.frames.length >= 1);
            extra.close();
        }
        await settle(150);
        tail.close();

        const messages = logBuffer.query({ limit: 1000 }).entries.map(e => e.message);
        expect(messages.filter(m => m.includes("/api/logs/stream"))).toHaveLength(0);
    });

    it("still records ordinary requests while a tail is attached", async () => {
        const app = buildApp({ flushMs: 20,
            heartbeatMs: 10_000 });
        const tail = await openTail(app);
        await tail.until(() => tail.frames.length >= 1);

        await app.request("/api/ping");
        const got = await tail.until(() => tail.entriesOf("append").length >= 1);
        tail.close();

        expect(got).toBe(true);
        expect(tail.entriesOf("append")[0].message).toMatch(/^GET \/api\/ping 200 \d+ms$/);
    });
});

/**
 * The exclusion, tested through the real wiring rather than through a hand-built
 * middleware stack.
 *
 * Every test above passes `ignorePaths` itself, which proves the option works and
 * proves nothing about whether production sets it. `configureMiddlewares` is
 * where it is actually decided, and the stream now subscribes before the response
 * is returned — so if that argument is ever dropped, self-logging is not a race
 * that might bite, it is guaranteed, on every connection.
 */
describe("configureMiddlewares wiring", () => {
    beforeEach(clearBuffer);

    it("excludes the tail from the sink it feeds", async () => {
        const { configureMiddlewares } = await import("../src/init/middlewares");
        const app = new Hono();
        configureMiddlewares(app as never, "/api", false, { corsHandled: true,
            compression: false });
        app.get("/api/ping", (c) => c.json({ ok: true }));
        app.route("/api/logs", createLogsRoutes({ flushMs: 20,
            heartbeatMs: 10_000 }));

        const tail = await openTail(app);
        await tail.until(() => tail.frames.length >= 1);
        await app.request("/api/ping");
        await tail.until(() => tail.entriesOf("append").length >= 1);

        const messages = logBuffer.query({ limit: 100 }).entries.map(e => e.message);
        expect(messages.filter(m => m.includes("/api/logs/stream"))).toHaveLength(0);
        // And it is still recording everything else.
        expect(messages.some(m => m.includes("/api/ping"))).toBe(true);
    });

    it("does not compress the stream", async () => {
        const { configureMiddlewares } = await import("../src/init/middlewares");
        const app = new Hono();
        // Compression on, as production has it. gzip emits on block boundaries,
        // so a compressed tail delivers nothing until enough events accumulate to
        // fill one — which is the entire property the stream exists to provide.
        configureMiddlewares(app as never, "/api", false, { corsHandled: true });
        app.route("/api/logs", createLogsRoutes({ flushMs: 20,
            heartbeatMs: 10_000 }));

        const controller = new AbortController();
        const res = await app.request("/api/logs/stream", {
            signal: controller.signal,
            headers: { "Accept-Encoding": "gzip, deflate" }
        });
        opened.push(new Tail(res, controller));

        expect(res.headers.get("Content-Encoding")).toBeNull();
        expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    });
});

describe("log ring buffer", () => {
    beforeEach(clearBuffer);

    it("evicts the oldest past its cap, and keeps streaming", async () => {
        const app = buildApp({ flushMs: 20,
            heartbeatMs: 10_000,
            maxPending: 20_000 });
        const tail = await openTail(app);
        await tail.until(() => tail.frames.length >= 1);

        // Past the 10k ring so `shift()` runs, which is also the path where a
        // subscriber could be handed an entry the buffer no longer holds.
        for (let i = 0; i < 10_050; i++) addLog("info", "system", `evict ${i}`);
        await tail.until(() => tail.entriesOf("append").length >= 10_050, 8000);
        tail.close();

        const held = logBuffer.query({ limit: 20_000 });
        expect(held.total).toBe(10_000);
        expect(held.entries[0].message).toBe("evict 10049"); // newest first
        // The stream saw every entry, including the ones since evicted: a
        // subscriber is fed on push, not on read.
        expect(tail.entriesOf("append")).toHaveLength(10_050);
    });

    it("does not let a throwing listener break the request being logged", async () => {
        const unsubscribe = logBuffer.subscribe(() => {
            throw new Error("a broken tail");
        });
        try {
            const app = buildApp();
            const res = await app.request("/api/ping");
            expect(res.status).toBe(200);
            expect(logBuffer.query({ limit: 10 }).total).toBe(1);
        } finally {
            unsubscribe();
        }
    });
});
