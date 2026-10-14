/**
 * A statement that fails on the managed database leaves its connection in step.
 *
 * PGlite (0.5.6) answers an extended-protocol message that fails with an
 * ErrorResponse and a ReadyForQuery at once, then answers the Sync after it
 * with a second ReadyForQuery — one Sync, two. Real Postgres sends one. When
 * the two arrive in one read, `pg` absorbs the extra one; when they arrive
 * apart, which a busy event loop does (a script beside a running `rebase dev`),
 * `pg` takes the second as the answer to the next query it sent:
 *
 *  - a refused `withAuth` write's ROLLBACK "finished" on the extra one, the
 *    pool saw the client released in a failed transaction (status 'E'), and
 *    the real ROLLBACK's answer arrived as "Received unexpected commandComplete
 *    message from backend" — the two `[pg-pool]` ERROR lines;
 *  - outside a transaction, the next query "finished" with no rows at all: a
 *    `SELECT` that answered `[]`.
 *
 * The proxy now drops the extra ReadyForQuery. The wire in these tests hands
 * the proxy one backend message at a time, a moment apart, so the reads split
 * the way they did under load, every run.
 *
 * Built as the daemon builds it: PGlite, the socket server with the daemon's
 * limit, the proxy in front.
 */
import net from "net";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { MANAGED_SERVER_MAX_CONNECTIONS } from "./constraints";
import { BackendMessageParser, NotificationProxy } from "./notification-proxy";
import { findFreePort } from "./state";

interface SocketServer {
    start(): Promise<void>;
    stop(): Promise<void>;
}

interface Database {
    exec(sql: string): Promise<unknown>;
    execProtocolRaw(message: Uint8Array): Promise<Uint8Array>;
    close(): Promise<void>;
}

/** A frontend message: type byte, Int32 length counting itself, body. */
function frontend(type: string, body: Buffer = Buffer.alloc(0)): Buffer {
    const message = Buffer.alloc(5 + body.length);
    message.write(type, 0, "ascii");
    message.writeInt32BE(4 + body.length, 1);
    body.copy(message, 5);
    return message;
}

/**
 * A wire between the socket server and the proxy that delivers the server's
 * messages one at a time, 2 ms apart, as separate writes.
 */
async function pacedWire(upstreamPort: number): Promise<{ port: number; close(): Promise<void> }> {
    const sockets = new Set<net.Socket>();
    const server = net.createServer((downstream) => {
        const upstream = net.connect(upstreamPort, "127.0.0.1");
        sockets.add(downstream);
        sockets.add(upstream);
        const parser = new BackendMessageParser();
        let paced = Promise.resolve();
        let startup = true;
        downstream.on("data", (chunk: Buffer) => upstream.write(chunk));
        upstream.on("data", (chunk: Buffer) => {
            // The startup exchange is passed straight through; the pacing is
            // for the conversation after it.
            if (startup) {
                downstream.write(chunk);
                if (chunk.includes(Buffer.from("Z\0\0\0\x05", "binary"))) startup = false;
                return;
            }
            for (const message of parser.push(chunk)) {
                paced = paced.then(() => new Promise<void>((resolve) => {
                    if (!downstream.destroyed) downstream.write(message);
                    setTimeout(resolve, 2);
                }));
            }
        });
        const close = () => {
            downstream.destroy();
            upstream.end();
        };
        downstream.on("close", close);
        downstream.on("error", close);
        upstream.on("close", close);
        upstream.on("error", close);
    });
    const port = await findFreePort();
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", () => resolve()));
    return {
        port,
        close: async () => {
            for (const socket of sockets) socket.destroy();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    };
}

describe("a failed statement through the proxy in front of the managed database", () => {
    let db: Database;
    let server: SocketServer;
    let wire: { port: number; close(): Promise<void> };
    let proxy: NotificationProxy;
    let url: string;
    const pools: pg.Pool[] = [];
    /** What the pools and their clients raised that no query was waiting for. */
    const stray: string[] = [];

    beforeAll(async () => {
        const { PGlite } = (await import("@electric-sql/pglite")) as {
            PGlite: { create(options?: unknown): Promise<Database> };
        };
        const { PGLiteSocketServer } = (await import("@electric-sql/pglite-socket")) as {
            PGLiteSocketServer: new (options: unknown) => SocketServer;
        };
        db = await PGlite.create();
        await db.exec(`
            CREATE ROLE rebase_user NOLOGIN;
            CREATE TABLE notes (id serial PRIMARY KEY, owner text NOT NULL, title text);
            ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
            ALTER TABLE notes FORCE ROW LEVEL SECURITY;
            CREATE POLICY owner_insert ON notes FOR INSERT TO rebase_user
                WITH CHECK (owner = current_setting('app.uid', true));
            GRANT SELECT, INSERT ON notes TO rebase_user;
            GRANT USAGE ON SEQUENCE notes_id_seq TO rebase_user;
            CREATE TABLE links (id int PRIMARY KEY, ref int REFERENCES links (id) DEFERRABLE INITIALLY DEFERRED);
        `);
        const upstreamPort = await findFreePort();
        server = new PGLiteSocketServer({
            db, port: upstreamPort, host: "127.0.0.1", maxConnections: MANAGED_SERVER_MAX_CONNECTIONS
        });
        await server.start();
        wire = await pacedWire(upstreamPort);
        const port = await findFreePort();
        proxy = new NotificationProxy({ listenPort: port, upstreamPort: wire.port });
        await proxy.start();
        url = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable`;
    });

    afterEach(async () => {
        await Promise.all(pools.splice(0).map((pool) => pool.end().catch(() => undefined)));
        stray.length = 0;
    });

    afterAll(async () => {
        await proxy?.stop();
        await wire?.close();
        await server?.stop();
        await db?.close();
    });

    /** A pool of one, as the managed database is reached, that records what no query caught. */
    function pool(): pg.Pool {
        const created = new pg.Pool({ connectionString: url, max: 1 });
        created.on("error", (error) => stray.push(`pool: ${error.message}`));
        created.on("connect", (client) => client.on("error", (error) => stray.push(`client: ${error.message}`)));
        created.on("release", (error: Error | undefined, client: pg.PoolClient & { _txStatus?: string }) => {
            if (!error && client._txStatus !== undefined && client._txStatus !== "I") {
                stray.push(`released in transaction status '${client._txStatus}'`);
            }
        });
        pools.push(created);
        return created;
    }

    it("hands a refused write's ROLLBACK its own answer, and releases the client clean", async () => {
        // What a refused `withAuth` write does: BEGIN, the auth context, the
        // INSERT the policy refuses, ROLLBACK.
        const writes = pool();
        for (let attempt = 0; attempt < 3; attempt++) {
            const client = await writes.connect();
            try {
                await client.query("BEGIN");
                await client.query("SELECT set_config('app.uid', $1, true), set_config('role', $2, true)", ["ada", "rebase_user"]);
                await expect(client.query("INSERT INTO notes (owner, title) VALUES ($1, $2)", ["bob", "x"]))
                    .rejects.toThrow(/row-level security/);
                await client.query("ROLLBACK");
            } finally {
                client.release();
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(stray).toEqual([]);
        expect((await writes.query("SELECT count(*)::int AS n FROM notes")).rows).toEqual([{ n: 0 }]);
    });

    /** One connection held across queries, as a script or a migration holds it. */
    async function session<T>(run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
        const client = await pool().connect();
        try {
            return await run(client);
        } finally {
            client.release();
        }
    }

    it("answers the query after a failed one with that query's rows", async () => {
        await session(async (client) => {
            for (let attempt = 0; attempt < 3; attempt++) {
                await expect(client.query("INSERT INTO notes (owner, title) VALUES (NULL, $1)", ["x"]))
                    .rejects.toThrow(/null value in column "owner"/);
                expect((await client.query("SELECT $1::int AS n", [attempt])).rows).toEqual([{ n: attempt }]);
            }
        });
        expect(stray).toEqual([]);
    });

    it("keeps the one ReadyForQuery of an error raised at the Sync itself", async () => {
        // A deferred foreign key fails when the implicit transaction commits,
        // which is the Sync: PGlite then sends one ReadyForQuery, not two, and
        // dropping it would leave the client waiting for ever.
        await session(async (client) => {
            await expect(client.query("INSERT INTO links (id, ref) VALUES ($1, 99)", [1]))
                .rejects.toThrow(/foreign key/);
            expect((await client.query("SELECT $1::int AS n", [7])).rows).toEqual([{ n: 7 }]);
        });
        expect(stray).toEqual([]);
    });

    it("is still needed: PGlite answers one failed extended request with two ReadyForQuery", async () => {
        // The defect the proxy corrects, measured on PGlite itself. When a
        // PGlite upgrade makes this fail, it answers one Sync with one
        // ReadyForQuery, as Postgres does, and `ReadyForQueryLedger` must go:
        // it would drop the only one, and every failed query would hang.
        // A database of its own: the socket server streams this one's output.
        const { PGlite } = (await import("@electric-sql/pglite")) as {
            PGlite: { create(options?: unknown): Promise<Database> };
        };
        const fresh = await PGlite.create();
        await fresh.exec("CREATE TABLE notes (id serial PRIMARY KEY, owner text NOT NULL)");
        const answers: string[] = [];
        for (const message of [
            // Parse: unnamed statement, the text, no parameter types.
            frontend("P", Buffer.from("\0INSERT INTO notes (owner) VALUES (NULL)\0\0\0", "binary")),
            // Bind: unnamed portal and statement, no formats, no parameters, no result formats.
            frontend("B", Buffer.from("\0\0\0\0\0\0\0\0", "binary")),
            // Describe the unnamed portal; Execute it with no row limit; Sync.
            frontend("D", Buffer.from("P\0", "binary")),
            frontend("E", Buffer.from("\0\0\0\0\0", "binary")),
            frontend("S")
        ]) {
            const reply = Buffer.from(await fresh.execProtocolRaw(new Uint8Array(message)));
            answers.push(new BackendMessageParser().push(reply).map((frame) => String.fromCharCode(frame[0])).join(""));
        }
        await fresh.close();
        expect(answers).toEqual(["1", "2", "n", "EZ", "Z"]);
    });

    it("keeps an ordinary failed simple query and its one ReadyForQuery", async () => {
        await session(async (client) => {
            await expect(client.query("SELECT 1/0")).rejects.toThrow(/division by zero/);
            expect((await client.query("SELECT 2 AS n")).rows).toEqual([{ n: 2 }]);
        });
        expect(stray).toEqual([]);
    });
});
