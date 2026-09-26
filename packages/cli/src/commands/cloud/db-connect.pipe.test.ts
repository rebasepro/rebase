/**
 * The local half of `db connect`, against a real WebSocket.
 *
 * This is what a developer's `psql` actually talks to, and the properties that
 * matter are the ones nothing else can check for it:
 *
 *  - **The token goes first, and nothing else does.** The endpoint authenticates
 *    in-band, so a client that sent its startup packet before the handshake
 *    would have those bytes read as a credential and be refused.
 *  - **Nothing is forwarded before `ready`.** The socket stays paused until the
 *    control plane says it has a database on the other end. A Postgres client
 *    writes its startup packet the instant it connects, so this is the ordinary
 *    case rather than an edge one.
 *  - **The bytes survive.** A pipe fails silently: a dropped, doubled or
 *    reordered chunk does not throw, it corrupts a length-prefixed Postgres
 *    message, and the error appears in somebody's client with nothing wrong
 *    visible here.
 *  - **A refusal reaches the developer.** The tunnel answers a rejection with a
 *    JSON frame, and a client left hanging on a socket that will never carry
 *    anything is the worst available outcome.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import net from "node:net";
import { WebSocketServer } from "ws";
import { pipeThroughTunnel, tunnelListener } from "./db-connect";

/** A stand-in for the control plane's tunnel endpoint. */
interface FakeTunnel {
    endpoint: string;
    /** Every text frame the client sent before the handshake completed. */
    handshake: unknown[];
    /** Bytes the client sent after `ready`. */
    received: () => Buffer;
    /** Send bytes back down the tunnel, as a database would. */
    send: (chunk: Buffer) => void;
    close: () => Promise<void>;
}

/**
 * A tunnel endpoint that behaves as the server does, or refuses.
 *
 * `refuse` sends the error frame the real endpoint sends for a gate failure.
 */
async function fakeTunnel(opts: { refuse?: { code: string; message: string } } = {}): Promise<FakeTunnel> {
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise<void>((resolve) => wss.once("listening", () => resolve()));

    const handshake: unknown[] = [];
    const chunks: Buffer[] = [];
    let socket: import("ws").WebSocket | null = null;

    wss.on("connection", (ws) => {
        socket = ws;
        ws.on("message", (data: Buffer, isBinary: boolean) => {
            if (isBinary) {
                chunks.push(Buffer.from(data));
                return;
            }
            handshake.push(JSON.parse(data.toString()));
            if (opts.refuse) {
                ws.send(JSON.stringify({ type: "error", ...opts.refuse }));
                ws.close(1008, opts.refuse.code);
                return;
            }
            ws.send(JSON.stringify({ type: "ready" }));
        });
    });

    return {
        endpoint: `ws://127.0.0.1:${(wss.address() as { port: number }).port}/api/db-tunnel/p1`,
        handshake,
        received: () => Buffer.concat(chunks),
        send: (chunk) => socket?.send(chunk, { binary: true }),
        close: () => new Promise<void>((resolve) => wss.close(() => resolve()))
    };
}

/** A local client connection, piped through the tunnel the way the command does. */
async function clientThrough(tunnel: FakeTunnel, token = "console-jwt") {
    const listener = net.createServer((incoming) => pipeThroughTunnel(incoming, tunnel.endpoint, token));
    await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", () => resolve()));
    const port = (listener.address() as { port: number }).port;

    const client = net.connect({ port, host: "127.0.0.1" });
    await new Promise<void>((resolve) => client.once("connect", () => resolve()));

    return {
        client,
        close: async () => {
            client.destroy();
            await new Promise<void>((resolve) => listener.close(() => resolve()));
        }
    };
}

/** Poll until `predicate` holds, so a test never waits on a fixed sleep. */
async function until(predicate: () => boolean, what: string, ms = 2000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("pipeThroughTunnel", () => {
    it("authenticates before anything else is sent", async () => {
        const tunnel = await fakeTunnel();
        const local = await clientThrough(tunnel);

        await until(() => tunnel.handshake.length === 1, "the handshake frame");
        expect(tunnel.handshake[0]).toEqual({ type: "authenticate", token: "console-jwt" });

        await local.close();
        await tunnel.close();
    });

    it("holds the client's first bytes until the tunnel is ready", async () => {
        // A Postgres client writes its startup packet immediately. Forwarding it
        // before `ready` would send it into a socket with no database behind it.
        const tunnel = await fakeTunnel();
        const local = await clientThrough(tunnel);
        local.client.write(Buffer.from("startup"));

        await until(() => tunnel.received().length > 0, "the forwarded startup packet");
        expect(tunnel.received().toString()).toBe("startup");
        // And it arrived after the handshake, never before it.
        expect(tunnel.handshake).toHaveLength(1);

        await local.close();
        await tunnel.close();
    });

    it("carries bytes back from the database to the client", async () => {
        const tunnel = await fakeTunnel();
        const local = await clientThrough(tunnel);
        await until(() => tunnel.handshake.length === 1, "the handshake frame");

        const back = new Promise<Buffer>((resolve) => local.client.once("data", (d: Buffer) => resolve(d)));
        tunnel.send(Buffer.from([0x52, 0x00, 0x00, 0x00, 0x08]));
        expect([...(await back)]).toEqual([0x52, 0x00, 0x00, 0x00, 0x08]);

        await local.close();
        await tunnel.close();
    });

    it("preserves a large payload byte for byte, in order", async () => {
        const tunnel = await fakeTunnel();
        const local = await clientThrough(tunnel);
        await until(() => tunnel.handshake.length === 1, "the handshake frame");

        // Numbered chunks: a size check alone would pass for a pipe that
        // reordered them, which is the failure that corrupts a result set.
        const chunks = Array.from({ length: 200 }, (_, i) => `[${i}]`);
        for (const chunk of chunks) local.client.write(chunk);

        const expected = chunks.join("");
        await until(() => tunnel.received().length >= expected.length, "every chunk");
        expect(tunnel.received().toString()).toBe(expected);

        await local.close();
        await tunnel.close();
    });

    it("closes the client's socket, with the reason, when the tunnel refuses", async () => {
        // Otherwise `psql` sits on a connection that will never speak, and the
        // developer sees a hang rather than "you need the admin role".
        const tunnel = await fakeTunnel({ refuse: { code: "forbidden", message: "requires the owner or admin role" } });
        const errors: string[] = [];
        vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
            errors.push(args.map(String).join(" "));
        });

        const local = await clientThrough(tunnel);
        const ended = new Promise<void>((resolve) => local.client.once("close", () => resolve()));
        await ended;

        expect(errors.join("\n")).toContain("requires the owner or admin role");

        await local.close();
        await tunnel.close();
    });
});

/**
 * The listener outlives the access token it started with.
 *
 * `db connect` is left running — its own page says so — and every connection
 * it accepts signs in to the tunnel separately. It used to present the token it
 * held at startup, which the control plane stops accepting within the hour:
 * from then on every new `psql` or pool connection was refused while the
 * tunnel went on "running", and nothing ever refreshed.
 */
describe("tunnelListener", () => {
    /** A session holder that can be told its token has lapsed. */
    function sessionHolder(refresh: () => Promise<{ accessToken: string }>) {
        let session = { accessToken: "token-at-start", expiresAt: Date.now() + 30 * 60_000 };
        const refreshSession = vi.fn(async () => {
            const next = await refresh();
            session = { accessToken: next.accessToken, expiresAt: Date.now() + 60 * 60_000 };
            return session;
        });
        return {
            client: { auth: { getSession: () => session, refreshSession } },
            refreshSession,
            expire: () => { session = { ...session, expiresAt: Date.now() - 1000 }; }
        };
    }

    async function open(listener: net.Server): Promise<number> {
        await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", () => resolve()));
        return (listener.address() as { port: number }).port;
    }

    it("signs a connection made after the token lapsed in with a refreshed one", async () => {
        const tunnel = await fakeTunnel();
        const holder = sessionHolder(async () => ({ accessToken: "token-refreshed" }));
        const listener = tunnelListener(holder.client, tunnel.endpoint);
        const port = await open(listener);

        const first = net.connect({ port, host: "127.0.0.1" });
        await until(() => tunnel.handshake.length === 1, "the first handshake");
        holder.expire();
        const second = net.connect({ port, host: "127.0.0.1" });
        await until(() => tunnel.handshake.length === 2, "the second handshake");

        expect(tunnel.handshake).toEqual([
            { type: "authenticate", token: "token-at-start" },
            { type: "authenticate", token: "token-refreshed" }
        ]);
        expect(holder.refreshSession).toHaveBeenCalledTimes(1);

        first.destroy();
        second.destroy();
        await new Promise<void>((resolve) => listener.close(() => resolve()));
        await tunnel.close();
    });

    it("closes the connection, and says why, when the session cannot be refreshed", async () => {
        // The control plane refuses a lapsed token, as its endpoint does.
        const tunnel = await fakeTunnel({ refuse: { code: "unauthenticated", message: "invalid or expired session" } });
        const holder = sessionHolder(async () => { throw new Error("refresh token revoked"); });
        holder.expire();
        const errors: string[] = [];
        vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
            errors.push(args.map(String).join(" "));
        });
        const listener = tunnelListener(holder.client, tunnel.endpoint);
        const port = await open(listener);

        const local = net.connect({ port, host: "127.0.0.1" });
        await new Promise<void>((resolve) => local.once("close", () => resolve()));

        expect(tunnel.handshake).toEqual([]);
        expect(errors.join("\n")).toContain("rebase cloud login");

        await new Promise<void>((resolve) => listener.close(() => resolve()));
        await tunnel.close();
    });
});
