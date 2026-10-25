/**
 * `rebase verify --live` (and `npx @rebasepro/rls-check "$(rebase db url)"`)
 * against the managed database while `rebase dev` runs.
 *
 * The managed database is one PGlite session every connection shares. The
 * audit used to `SET default_transaction_read_only = on` and a
 * `statement_timeout` at session level and never put them back, so after one
 * audit every client — the running dev backend, `db push`, `console`, sign-up —
 * failed its writes with `cannot execute … in a read-only transaction` until
 * `rebase db stop`.
 *
 * Built here as the daemon builds it (PGlite, the socket server with the same
 * limit, the notification proxy in front), with a connection held for the dev
 * server, and rls-check's own `scan` run from source.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { scan } from "@rebasepro/rls-check";

import { MANAGED_SERVER_MAX_CONNECTIONS } from "./constraints";
import { managedUrl } from "./daemon";
import { NotificationProxy } from "./notification-proxy";
import { findFreePort } from "./state";

describe("the live RLS audit against the managed database while a dev server holds a connection", () => {
    let db: { close(): Promise<void> };
    let server: { stop(): Promise<void> };
    let proxy: NotificationProxy;
    let url: string;
    let dev: pg.Client;

    beforeAll(async () => {
        const { PGlite } = (await import("@electric-sql/pglite")) as {
            PGlite: { create(options?: unknown): Promise<{ close(): Promise<void> }> };
        };
        const { PGLiteSocketServer } = (await import("@electric-sql/pglite-socket")) as {
            PGLiteSocketServer: new (options: unknown) => { start(): Promise<void>; stop(): Promise<void> };
        };
        db = await PGlite.create();
        const upstreamPort = await findFreePort();
        const socketServer = new PGLiteSocketServer({
            db, port: upstreamPort, host: "127.0.0.1", maxConnections: MANAGED_SERVER_MAX_CONNECTIONS
        });
        await socketServer.start();
        server = socketServer;
        const listenPort = await findFreePort();
        proxy = new NotificationProxy({ listenPort, upstreamPort });
        await proxy.start();
        url = managedUrl(listenPort);

        dev = new pg.Client({ connectionString: url });
        await dev.connect();
        await dev.query("CREATE TABLE public.posts (id serial PRIMARY KEY, title text NOT NULL)");
    });

    afterAll(async () => {
        await dev?.end().catch(() => undefined);
        await proxy?.stop();
        await server?.stop();
        await db?.close();
    });

    const session = async () => {
        const { rows } = await dev.query<{ read_only: string; timeout: string }>(
            "SELECT current_setting('default_transaction_read_only') AS read_only, current_setting('statement_timeout') AS timeout"
        );
        return rows[0];
    };

    it("leaves the shared session writable, with the statement timeout it had", async () => {
        const before = await session();
        expect(before.read_only).toBe("off");

        for (const run of [1, 2]) {
            const result = await scan({ connectionString: url, statementTimeoutMs: 10_000 });
            expect(result.database.name, `scan ${run}`).toBeTruthy();
            expect(await session(), `after scan ${run}`).toEqual(before);
        }

        // What the dev backend, `db push` and sign-up do next.
        await dev.query("INSERT INTO public.posts (title) VALUES ('after the audit')");
        await dev.query("CREATE TABLE public.zz_probe (id int)");
        const { rows } = await dev.query<{ n: string }>("SELECT count(*) AS n FROM public.posts");
        expect(Number(rows[0].n)).toBe(1);
    });
});
