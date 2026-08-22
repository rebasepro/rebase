/**
 * The proxy that puts LISTEN/NOTIFY back, and the frame parser under it.
 *
 * The parser tests exist because the failure they guard is not reproducible on
 * demand: TCP may split a protocol message across chunks under load and not at
 * all on a quiet laptop, and a proxy that assumed one chunk was one message
 * would inject a notification into the middle of a row description — corrupting
 * a connection in a way that looks like a driver bug.
 *
 * The end-to-end test is the one that proves the feature. It reproduces the
 * realtime engine's exact shape: a dedicated connection issuing `LISTEN`, and
 * writes arriving on a different connection. That combination was silently
 * broken before this proxy existed, and "silently" is the word that matters —
 * every query succeeded, and the events simply never came.
 */

import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";

import { MANAGED_POOL_MAX } from "./constraints";
import { ensureManagedDatabase, stopManagedDatabase } from "./daemon";
import {
    BackendMessageParser,
    NotificationProxy,
    decodeNotification,
    isNotificationFrame
} from "./notification-proxy";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI_ENTRY = path.join(HERE, "__fixtures__", "cli-entry.ts");
const BOOT_TIMEOUT = 90_000;

/** A backend message: type byte, Int32 length counting itself, payload. */
function frame(type: string, payload: Buffer = Buffer.alloc(0)): Buffer {
    const message = Buffer.alloc(5 + payload.length);
    message.write(type, 0, "ascii");
    message.writeInt32BE(4 + payload.length, 1);
    payload.copy(message, 5);

    return message;
}

/** A NotificationResponse for `channel` / `payload`. */
function notification(channel: string, payload: string, pid = 1234): Buffer {
    const body = Buffer.concat([
        (() => {
            const b = Buffer.alloc(4);
            b.writeInt32BE(pid, 0);

            return b;
        })(),
        Buffer.from(`${channel}\0${payload}\0`, "utf8")
    ]);

    return frame("A", body);
}

describe("BackendMessageParser", () => {
    it("splits a buffer holding several whole messages", () => {
        const parser = new BackendMessageParser();
        const messages = parser.push(Buffer.concat([frame("Z"), frame("T"), frame("C")]));

        expect(messages.map((m) => String.fromCharCode(m[0]))).toEqual(["Z", "T", "C"]);
        expect(parser.pending).toBe(0);
    });

    it("holds a message that arrives in pieces until it is whole", () => {
        // The regression: writing a partial message on, then injecting a
        // notification behind it, desynchronises the client's parser for the
        // rest of the connection.
        const parser = new BackendMessageParser();
        const whole = frame("T", Buffer.from("row description"));

        expect(parser.push(whole.subarray(0, 3))).toEqual([]);
        expect(parser.push(whole.subarray(3, 9))).toEqual([]);
        expect(parser.pending).toBeGreaterThan(0);

        const finished = parser.push(whole.subarray(9));
        expect(finished).toHaveLength(1);
        expect(finished[0].equals(whole)).toBe(true);
        expect(parser.pending).toBe(0);
    });

    it("emits the leading whole message and keeps the trailing fragment", () => {
        const parser = new BackendMessageParser();
        const first = frame("Z");
        const second = frame("T", Buffer.from("partial"));

        const messages = parser.push(Buffer.concat([first, second.subarray(0, 4)]));

        expect(messages).toHaveLength(1);
        expect(messages[0].equals(first)).toBe(true);
        expect(parser.pending).toBe(4);
    });

    it("passes the untyped SSL negotiation byte through without framing it", () => {
        // The one thing on the wire that is not `type + length`. Parsing it as
        // a typed message would desynchronise everything after it.
        const parser = new BackendMessageParser();
        parser.expectSslReply();

        const messages = parser.push(Buffer.concat([Buffer.from("N", "ascii"), frame("R")]));

        expect(messages).toHaveLength(2);
        expect(messages[0].toString("ascii")).toBe("N");
        expect(String.fromCharCode(messages[1][0])).toBe("R");
    });

    it("stops rather than guessing when a length cannot describe itself", () => {
        const parser = new BackendMessageParser();
        const broken = Buffer.from([0x5a, 0x00, 0x00, 0x00, 0x01]);

        expect(parser.push(broken)).toEqual([]);
    });
});

describe("notification frames", () => {
    it("recognises a NotificationResponse and nothing else", () => {
        expect(isNotificationFrame(notification("c", "p"))).toBe(true);
        expect(isNotificationFrame(frame("Z"))).toBe(false);
        expect(isNotificationFrame(Buffer.alloc(0))).toBe(false);
    });

    it("decodes the channel and payload", () => {
        expect(decodeNotification(notification("rebase_cdc", "orders:42"))).toEqual({
            channel: "rebase_cdc",
            payload: "orders:42"
        });
    });

    it("decodes an empty payload, which NOTIFY without an argument produces", () => {
        expect(decodeNotification(notification("plain", ""))).toEqual({ channel: "plain", payload: "" });
    });

    it("returns null for a frame that is not one", () => {
        expect(decodeNotification(frame("Z"))).toBeNull();
    });
});

describe("NotificationProxy", () => {
    let upstream: net.Server;
    let upstreamPort: number;
    let proxy: NotificationProxy | null = null;
    const sockets: net.Socket[] = [];
    /** Sends whatever the test asks, to whichever upstream connection. */
    const upstreamSockets: net.Socket[] = [];

    beforeEach(async () => {
        upstream = net.createServer((socket) => {
            upstreamSockets.push(socket);
            socket.on("error", () => undefined);
        });
        await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", () => resolve()));
        upstreamPort = (upstream.address() as net.AddressInfo).port;
    });

    afterEach(async () => {
        for (const socket of sockets.splice(0)) socket.destroy();
        upstreamSockets.splice(0);
        await proxy?.stop();
        proxy = null;
        await new Promise<void>((resolve) => upstream.close(() => resolve()));
    });

    async function connectClient(port: number): Promise<{ socket: net.Socket; received: Buffer[] }> {
        const socket = net.connect(port, "127.0.0.1");
        const received: Buffer[] = [];
        socket.on("data", (chunk: Buffer) => received.push(chunk));
        socket.on("error", () => undefined);
        sockets.push(socket);
        await new Promise<void>((resolve) => socket.once("connect", () => resolve()));

        return { socket, received };
    }

    it("copies a notification to the other client, and not back to its origin", async () => {
        const listenPort = 0;
        // Bind an ephemeral port by asking the OS through a throwaway server.
        const probe = net.createServer();
        await new Promise<void>((resolve) => probe.listen(listenPort, "127.0.0.1", () => resolve()));
        const port = (probe.address() as net.AddressInfo).port;
        await new Promise<void>((resolve) => probe.close(() => resolve()));

        const seen: { channel: string; copies: number }[] = [];
        proxy = new NotificationProxy({
            listenPort: port,
            upstreamPort,
            onNotification: (channel, _payload, copies) => seen.push({ channel, copies })
        });
        await proxy.start();

        const a = await connectClient(port);
        const b = await connectClient(port);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(upstreamSockets).toHaveLength(2);

        // Upstream delivers the notification to A only — the defect this fixes.
        upstreamSockets[0].write(notification("rebase_cdc", "orders:1"));
        await new Promise((resolve) => setTimeout(resolve, 200));

        const bBytes = Buffer.concat(b.received);
        expect(decodeNotification(bBytes)).toEqual({ channel: "rebase_cdc", payload: "orders:1" });
        // A still gets its own copy exactly once — forwarded, never duplicated.
        expect(Buffer.concat(a.received).length).toBe(notification("rebase_cdc", "orders:1").length);
        expect(seen).toEqual([{ channel: "rebase_cdc", copies: 1 }]);
    });

    it("forwards ordinary traffic unchanged", async () => {
        const probe = net.createServer();
        await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", () => resolve()));
        const port = (probe.address() as net.AddressInfo).port;
        await new Promise<void>((resolve) => probe.close(() => resolve()));

        proxy = new NotificationProxy({ listenPort: port, upstreamPort });
        await proxy.start();

        const client = await connectClient(port);
        await new Promise((resolve) => setTimeout(resolve, 100));

        const payload = Buffer.concat([frame("T", Buffer.from("cols")), frame("D"), frame("Z")]);
        upstreamSockets[0].write(payload);
        await new Promise((resolve) => setTimeout(resolve, 200));

        expect(Buffer.concat(client.received).equals(payload)).toBe(true);
    });
});

describe("realtime against the managed database", () => {
    let root: string;
    const pools: pg.Pool[] = [];
    const clients: pg.Client[] = [];

    beforeEach(() => {
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-rt-")));
    });

    afterEach(async () => {
        await Promise.all(clients.splice(0).map((c) => c.end().catch(() => undefined)));
        await Promise.all(pools.splice(0).map((p) => p.end().catch(() => undefined)));
        await stopManagedDatabase(root).catch(() => undefined);
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("delivers trigger-fired CDC to a dedicated listener", { timeout: BOOT_TIMEOUT }, async () => {
        // The realtime engine's exact shape, and the case that was broken:
        // LISTEN on its own connection, writes arriving on another.
        const database = await ensureManagedDatabase(root, { entry: CLI_ENTRY, quiet: true });

        const listener = new pg.Client({ connectionString: database.url });
        clients.push(listener);
        await listener.connect();
        const received: string[] = [];
        listener.on("notification", (message) => received.push(`${message.channel}:${message.payload}`));
        await listener.query("LISTEN rebase_cdc");

        const pool = new pg.Pool({ connectionString: database.url, max: MANAGED_POOL_MAX });
        pools.push(pool);
        await pool.query("CREATE TABLE orders (id int primary key)");
        await pool.query(
            "CREATE FUNCTION notify_change() RETURNS trigger AS $$ BEGIN " +
            "PERFORM pg_notify('rebase_cdc', TG_TABLE_NAME || ':' || NEW.id); RETURN NEW; END $$ LANGUAGE plpgsql"
        );
        await pool.query(
            "CREATE TRIGGER orders_changed AFTER INSERT ON orders FOR EACH ROW EXECUTE FUNCTION notify_change()"
        );

        await pool.query("INSERT INTO orders VALUES (1)");
        await new Promise((resolve) => setTimeout(resolve, 800));

        expect(received).toEqual(["rebase_cdc:orders:1"]);
    });

    it("delivers every event in a burst, in order", { timeout: BOOT_TIMEOUT }, async () => {
        const database = await ensureManagedDatabase(root, { entry: CLI_ENTRY, quiet: true });

        const listener = new pg.Client({ connectionString: database.url });
        clients.push(listener);
        await listener.connect();
        const received: string[] = [];
        listener.on("notification", (message) => received.push(String(message.payload)));
        await listener.query("LISTEN burst");

        const pool = new pg.Pool({ connectionString: database.url, max: MANAGED_POOL_MAX });
        pools.push(pool);
        for (let i = 0; i < 10; i += 1) await pool.query("SELECT pg_notify('burst', $1)", [String(i)]);
        await new Promise((resolve) => setTimeout(resolve, 1000));

        expect(received).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    });

    it("does not deliver a notification from a rolled-back transaction", { timeout: BOOT_TIMEOUT }, async () => {
        // Postgres queues NOTIFY until commit. A proxy that invented delivery
        // rather than forwarding real frames would get this wrong, and realtime
        // would show rows that do not exist.
        const database = await ensureManagedDatabase(root, { entry: CLI_ENTRY, quiet: true });

        const listener = new pg.Client({ connectionString: database.url });
        clients.push(listener);
        await listener.connect();
        const received: string[] = [];
        listener.on("notification", (message) => received.push(String(message.payload)));
        await listener.query("LISTEN rolled_back");

        const pool = new pg.Pool({ connectionString: database.url, max: MANAGED_POOL_MAX });
        pools.push(pool);
        const client = await pool.connect();
        await client.query("BEGIN");
        await client.query("SELECT pg_notify('rolled_back', 'should-not-arrive')");
        await client.query("ROLLBACK");
        client.release();
        await new Promise((resolve) => setTimeout(resolve, 800));

        expect(received).toEqual([]);
    });

    it("leaves ordinary queries working through the proxy", { timeout: BOOT_TIMEOUT }, async () => {
        const database = await ensureManagedDatabase(root, { entry: CLI_ENTRY, quiet: true });
        const pool = new pg.Pool({ connectionString: database.url, max: MANAGED_POOL_MAX });
        pools.push(pool);

        await pool.query("CREATE TABLE t (id int primary key, v text)");
        for (let i = 0; i < 25; i += 1) await pool.query("INSERT INTO t VALUES ($1, $2)", [i, `row-${i}`]);

        const { rows } = await pool.query<{ c: number }>("select count(*)::int c from t");
        expect(rows[0].c).toBe(25);
    });
});
