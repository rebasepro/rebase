import { describe, it, expect } from "@jest/globals";
import { createServer, type Server } from "http";
import { AddressInfo } from "net";
import { Hono } from "hono";
import { getRequestListener } from "@hono/node-server";
import { createShutdown } from "../src/init/shutdown";
import { createLogsRoutes } from "../src/api/logs-routes";

/**
 * An open Logs Explorer tail does not hold a shutdown hostage.
 *
 * `server.close()` waits for every open connection, and the log stream's loop
 * ended only when its client went away. An admin with Studio → Logs open
 * during a rollout held SIGTERM for the whole force timeout — 13s, then
 * "Forced shutdown" — and on a host whose grace period is shorter than that
 * (Cloud Run's and `docker stop`'s are 10s) the process was killed before the
 * pool was closed. WebSockets were already closed at shutdown; this stream
 * was not.
 */
describe("createShutdown with a log stream open", () => {
    async function listen(app: Hono): Promise<{ server: Server; url: string }> {
        const server = createServer(getRequestListener(app.fetch));
        await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
        const { port } = server.address() as AddressInfo;
        return { server, url: `http://127.0.0.1:${port}` };
    }

    it("ends the stream and closes the server well inside the budget", async () => {
        const closing = new AbortController();
        const app = new Hono();
        app.route("/api/admin/logs", createLogsRoutes({ flushMs: 20, heartbeatMs: 60 }, { closeSignal: closing.signal }));
        const { server, url } = await listen(app);

        const res = await fetch(`${url}/api/admin/logs/stream`);
        const reader = res.body!.getReader();
        await reader.read(); // the snapshot: the stream is open and being served

        const shutdown = createShutdown({
            server,
            realtimeServices: {},
            closeLongLivedResponses: () => closing.abort()
        });

        const started = Date.now();
        try {
            await shutdown(5_000);
            expect(Date.now() - started).toBeLessThan(1_500);
            expect(server.listening).toBe(false);
            // And the client sees its stream end rather than hang.
            let done = false;
            for (let i = 0; i < 20 && !done; i++) done = (await reader.read()).done;
            expect(done).toBe(true);
        } finally {
            if (server.listening) server.closeAllConnections();
            if (server.listening) server.close();
        }
    });

    it("ends a stream opened after shutdown began, instead of starting a tail", async () => {
        const closing = new AbortController();
        closing.abort();
        const app = new Hono();
        app.route("/api/admin/logs", createLogsRoutes({ flushMs: 20, heartbeatMs: 60 }, { closeSignal: closing.signal }));

        const res = await app.request("/api/admin/logs/stream");
        // Resolves only because the stream ends by itself; a tail never would.
        const text = await Promise.race([
            res.text(),
            new Promise<string>(resolve => setTimeout(() => resolve("<still open>"), 1_000))
        ]);
        expect(text).not.toBe("<still open>");
    });
});
