import { gunzipSync } from "node:zlib";
import { Hono } from "hono";
import { configureMiddlewares } from "../src/init/middlewares";
import { HonoEnv } from "../src/api/types";

// A list response in the shape the data API actually returns, big enough to be
// representative and compressible enough for the ratio to be meaningful.
const payload = Array.from({ length: 200 }, (_, i) => ({
    id: i,
    name: "Rebase",
    description: "a".repeat(200)
}));

function buildApp(config: Parameters<typeof configureMiddlewares>[3] = {}) {
    const app = new Hono<HonoEnv>();
    configureMiddlewares(app, "/api", false, config);
    app.get("/api/rows", (c) => c.json(payload));
    app.get("/api/photo", (c) => c.body("x".repeat(5000), 200, { "Content-Type": "image/jpeg" }));
    app.get("/api/stream", (c) => c.body("data: hi\n\n".repeat(500), 200, { "Content-Type": "text/event-stream" }));
    app.get("/api/partial", (c) => c.body("a".repeat(5000), 206, {
        "Content-Type": "text/plain",
        "Content-Range": "bytes 0-4999/100000"
    }));
    return app;
}

describe("response compression", () => {
    it("gzips a large JSON response when the client accepts gzip", async () => {
        const res = await buildApp().request("/api/rows", {
            headers: { "Accept-Encoding": "gzip, br" }
        });

        expect(res.headers.get("Content-Encoding")).toBe("gzip");

        // Decode it the way an HTTP client would, and confirm the payload
        // survives the round trip intact rather than merely arriving small.
        const wire = Buffer.from(await res.arrayBuffer());
        const decoded = gunzipSync(wire);
        expect(JSON.parse(decoded.toString())).toEqual(payload);
        expect(wire.byteLength).toBeLessThan(decoded.byteLength / 4);
    });

    it("stops advertising a stale Content-Length once the body is encoded", async () => {
        const res = await buildApp().request("/api/rows", {
            headers: { "Accept-Encoding": "gzip" }
        });

        // A Content-Length describing the *uncompressed* body would desync the
        // response framing and hang or truncate the client.
        expect(res.headers.get("Content-Length")).toBeNull();
    });

    it("leaves the response identity-encoded when the client accepts no encoding", async () => {
        const res = await buildApp().request("/api/rows");

        expect(res.headers.get("Content-Encoding")).toBeNull();
        expect(await res.json()).toEqual(payload);
    });

    it("can be disabled entirely", async () => {
        const res = await buildApp({ compression: false }).request("/api/rows", {
            headers: { "Accept-Encoding": "gzip" }
        });

        expect(res.headers.get("Content-Encoding")).toBeNull();
        expect(await res.json()).toEqual(payload);
    });

    it("does not re-compress already-compressed content types", async () => {
        const res = await buildApp().request("/api/photo", {
            headers: { "Accept-Encoding": "gzip" }
        });

        expect(res.headers.get("Content-Encoding")).toBeNull();
    });

    it("does not compress server-sent event streams", async () => {
        const res = await buildApp().request("/api/stream", {
            headers: { "Accept-Encoding": "gzip" }
        });

        expect(res.headers.get("Content-Encoding")).toBeNull();
    });

    it("does not compress a range response", async () => {
        const res = await buildApp().request("/api/partial", {
            headers: { "Accept-Encoding": "gzip", Range: "bytes=0-4999" }
        });

        // Content-Range counts offsets into the identity body; gzipping the
        // payload behind it would desync the framing from the bytes sent.
        expect(res.status).toBe(206);
        expect(res.headers.get("Content-Encoding")).toBeNull();
        expect((await res.text()).length).toBe(5000);
    });

    it("marks responses as varying on Accept-Encoding, so caches cannot cross-serve", async () => {
        const compressed = await buildApp().request("/api/rows", {
            headers: { "Accept-Encoding": "gzip" }
        });
        const identity = await buildApp().request("/api/rows");

        // Both directions matter: a cache keyed without Accept-Encoding could
        // serve either body to the wrong client.
        expect(compressed.headers.get("Vary")).toMatch(/accept-encoding/i);
        expect(identity.headers.get("Vary")).toMatch(/accept-encoding/i);
    });

    /**
     * Below 1 KB gzip costs more than it saves: a 119-byte row cost 118 µs of
     * CPU per request compressed against 25 µs identity, and a 37-byte body
     * came out at 57. Hono's `compress` has that 1 KB threshold, but reads it
     * from `Content-Length`, which `c.json()` never sets — so nothing was ever
     * below it.
     */
    describe("small bodies", () => {
        function smallApp() {
            const app = new Hono<HonoEnv>();
            configureMiddlewares(app, "/api", false, {});
            app.get("/api/one", (c) => c.json({ a: 1 }));
            app.get("/api/missing", (c) => c.json({ error: { code: "NOT_FOUND", message: "No such row" } }, 404));
            app.get("/api/drip", (c) => c.body(new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode("a".repeat(100)));
                    controller.enqueue(new TextEncoder().encode("b".repeat(100)));
                    controller.close();
                }
            }), 200, { "Content-Type": "text/plain" }));
            app.get("/api/flood", (c) => c.body(new ReadableStream<Uint8Array>({
                start(controller) {
                    for (let i = 0; i < 8; i++) controller.enqueue(new TextEncoder().encode(String(i).repeat(600)));
                    controller.close();
                }
            }), 200, { "Content-Type": "text/plain" }));
            return app;
        }

        it("leaves a small JSON response identity-encoded, with its length", async () => {
            const res = await smallApp().request("/api/one", { headers: { "Accept-Encoding": "gzip, deflate, br" } });

            expect(res.headers.get("Content-Encoding")).toBeNull();
            expect(res.headers.get("Content-Length")).toBe("7");
            expect(res.headers.get("Vary")).toMatch(/accept-encoding/i);
            expect(await res.json()).toEqual({ a: 1 });
        });

        it("does the same for a small error body, keeping its status", async () => {
            const res = await smallApp().request("/api/missing", { headers: { "Accept-Encoding": "gzip" } });

            expect(res.status).toBe(404);
            expect(res.headers.get("Content-Encoding")).toBeNull();
            expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "No such row" } });
        });

        it("measures a streamed body that turns out small, and sends it as it was", async () => {
            const res = await smallApp().request("/api/drip", { headers: { "Accept-Encoding": "gzip" } });

            expect(res.headers.get("Content-Encoding")).toBeNull();
            expect(res.headers.get("Content-Length")).toBe("200");
            expect(await res.text()).toBe("a".repeat(100) + "b".repeat(100));
        });

        it("still gzips a streamed body past the threshold, every byte of it", async () => {
            const res = await smallApp().request("/api/flood", { headers: { "Accept-Encoding": "gzip" } });

            expect(res.headers.get("Content-Encoding")).toBe("gzip");
            const decoded = gunzipSync(Buffer.from(await res.arrayBuffer())).toString();
            expect(decoded).toBe(Array.from({ length: 8 }, (_, i) => String(i).repeat(600)).join(""));
        });

        it("still gzips a JSON response just past 1 KB", async () => {
            const app = new Hono<HonoEnv>();
            configureMiddlewares(app, "/api", false, {});
            const body = { text: "x".repeat(1100) };
            app.get("/api/kb", (c) => c.json(body));

            const res = await app.request("/api/kb", { headers: { "Accept-Encoding": "gzip" } });

            expect(res.headers.get("Content-Encoding")).toBe("gzip");
            expect(JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString())).toEqual(body);
        });
    });

    it("does not duplicate an Accept-Encoding vary that is already present", async () => {
        const app = new Hono<HonoEnv>();
        configureMiddlewares(app, "/api", false, {});
        app.get("/api/varied", (c) => c.json(payload, 200, { Vary: "Accept-Encoding" }));

        const res = await app.request("/api/varied", { headers: { "Accept-Encoding": "gzip" } });

        expect(res.headers.get("Vary")).toBe("Accept-Encoding");
    });
});
