/**
 * A connection the managed database has no room for is refused in words.
 *
 * `PGLiteSocketServer` (0.2.9) sets its limit on the listening socket, so Node
 * closes a connection over it as soon as it is accepted, before a byte is read:
 * every client read it as a dropped connection. Two backends beside
 * `rebase dev` failed with "Connection terminated unexpectedly" and a stack,
 * which reads as "the database is down".
 *
 * The proxy answers such a client the way Postgres answers one over its
 * `max_connections`: a FATAL ErrorResponse, SQLSTATE 53300, here naming the
 * managed database's limit, what holds it and what to do. Every client prints
 * it, the server, `pg`, psql and Atlas alike.
 *
 * Built as the daemon builds it: PGlite, the socket server, the proxy in front.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NotificationProxy } from "./notification-proxy";
import { findFreePort } from "./state";

interface SocketServer {
    start(): Promise<void>;
    stop(): Promise<void>;
}

describe("the proxy in front of a managed database with no free connection", () => {
    let db: { close(): Promise<void> };
    let server: SocketServer;
    let proxy: NotificationProxy;
    let url: string;

    beforeAll(async () => {
        const { PGlite } = (await import("@electric-sql/pglite")) as {
            PGlite: { create(options?: unknown): Promise<{ close(): Promise<void> }> };
        };
        const { PGLiteSocketServer } = (await import("@electric-sql/pglite-socket")) as {
            PGLiteSocketServer: new (options: unknown) => SocketServer;
        };
        db = await PGlite.create();
        const upstreamPort = await findFreePort();
        // One, so the second client is the one over the limit.
        server = new PGLiteSocketServer({ db, port: upstreamPort, host: "127.0.0.1", maxConnections: 1 });
        await server.start();
        const port = await findFreePort();
        proxy = new NotificationProxy({ listenPort: port, upstreamPort, maxConnections: 1 });
        await proxy.start();
        url = `postgresql://postgres@127.0.0.1:${port}/postgres?sslmode=disable`;
    });

    afterAll(async () => {
        await proxy?.stop();
        await server?.stop();
        await db?.close();
    });

    it("refuses the client over the limit with SQLSTATE 53300, saying what holds the connections and what to do", async () => {
        const holder = new pg.Client({ connectionString: url });
        await holder.connect();
        try {
            const late = new pg.Client({ connectionString: url });
            const refusal = await late.connect().then(() => null, (error: unknown) => error);
            await late.end().catch(() => undefined);

            expect(refusal).toBeInstanceOf(pg.DatabaseError);
            if (!(refusal instanceof pg.DatabaseError)) return;
            expect(refusal.code).toBe("53300");
            expect(refusal.severity).toBe("FATAL");
            expect(refusal.message).toBe(
                "The managed development database has no free connection: it accepts only a few at a time, " +
                "and other clients hold them — a running `rebase dev` holds some."
            );
            expect(refusal.hint).toContain("rebase dev --docker");

            // The client that holds the connection is untouched.
            expect((await holder.query("SELECT 1 AS n")).rows).toEqual([{ n: 1 }]);
        } finally {
            await holder.end();
        }
    });
});
