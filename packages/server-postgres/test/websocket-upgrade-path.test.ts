import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { createServer, type IncomingMessage, type Server } from "http";
import type { AddressInfo } from "net";
import type { Duplex } from "stream";
import { WebSocket, WebSocketServer } from "ws";

import { createPostgresWebSocket } from "../src/websocket";
import { createPostgresBootstrapper } from "../src/PostgresBootstrapper";
import type { RealtimeService } from "../src/services/realtimeService";
import type { PostgresBackendDriver } from "../src/PostgresBackendDriver";

/**
 * The realtime socket shares the host's `http.Server` and answers ONE path.
 *
 * It used to be `new WebSocketServer({ server })` with no path, which in `ws`
 * means every upgrade on the server is Rebase's: a host app that ran its own
 * WebSocket on `/chat` had both servers answer the same socket, and the second
 * threw "handleUpgrade() was called more than once". The cloud control plane
 * worked round it by lifting Rebase's listener off and re-dispatching to it.
 *
 * Real sockets on a real `http.Server` throughout — the bug lived in how two
 * `upgrade` listeners share one, which a mocked `ws` cannot show.
 */

type Dialled =
    | { kind: "open"; firstMessage: Promise<string>; socket: WebSocket }
    | { kind: "refused"; status: number }
    | { kind: "error"; message: string }
    | { kind: "hung" };

const servers: Server[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.terminate();
    for (const server of servers.splice(0)) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
});

function stubs() {
    const addClient = jest.fn();
    const realtime = {
        addClient,
        handleClientMessage: jest.fn(async () => undefined),
        rescopeClient: jest.fn(async () => undefined)
    } as unknown as RealtimeService;
    const driver = { key: "postgres", initialised: true } as unknown as PostgresBackendDriver;
    return { addClient, realtime, driver };
}

function rebaseSocketOn(server: Server, path?: string) {
    const { addClient, realtime, driver } = stubs();
    createPostgresWebSocket(server, realtime, driver, { requireAuth: false }, undefined, path === undefined ? undefined : { path });
    return { addClient };
}

/** A host app's own WebSocket on `/chat`, routed the way `ws` documents for a shared server. */
function hostChatOn(server: Server) {
    const chat = new WebSocketServer({ noServer: true });
    chat.on("connection", (socket) => socket.send("chat-hello"));
    server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
        if (new URL(request.url ?? "/", "http://host").pathname !== "/chat") return;
        chat.handleUpgrade(request, socket, head, (client) => chat.emit("connection", client, request));
    });
}

async function listen(server: Server): Promise<number> {
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    return (server.address() as AddressInfo).port;
}

function dial(port: number, path: string): Promise<Dialled> {
    return new Promise((resolve) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
        sockets.push(socket);
        const hung = setTimeout(() => resolve({ kind: "hung" }), 1500);
        const done = (result: Dialled) => {
            clearTimeout(hung);
            resolve(result);
        };
        const firstMessage = new Promise<string>((resolveMessage) => {
            socket.once("message", (data) => resolveMessage(String(data)));
        });
        socket.once("open", () => done({ kind: "open", firstMessage, socket }));
        socket.once("unexpected-response", (_request, response) => done({ kind: "refused", status: response.statusCode ?? 0 }));
        socket.once("error", (error) => done({ kind: "error", message: error.message }));
    });
}

/** What a dial came to, as one comparable word. */
async function answer(port: number, path: string): Promise<string> {
    const dialled = await dial(port, path);
    if (dialled.kind === "refused") return `refused ${dialled.status}`;
    if (dialled.kind === "error") return `error: ${dialled.message}`;
    return dialled.kind;
}

function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
    return Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), 1000))]);
}

describe("the realtime socket answers its own path, and only that", () => {
    it.each([
        ["Rebase mounted first", "rebase-first"],
        ["the host's socket mounted first", "host-first"]
    ])("a host's own WebSocket on /chat works beside it (%s)", async (_label, order) => {
        const server = createServer();
        let rebase: { addClient: jest.Mock };
        if (order === "rebase-first") {
            rebase = rebaseSocketOn(server);
            hostChatOn(server);
        } else {
            hostChatOn(server);
            rebase = rebaseSocketOn(server);
        }
        const port = await listen(server);

        const chat = await dial(port, "/chat");
        expect(chat.kind).toBe("open");
        if (chat.kind !== "open") return;
        expect(await withTimeout(chat.firstMessage, "<nothing>")).toBe("chat-hello");
        expect(rebase.addClient).not.toHaveBeenCalled();

        expect(await answer(port, "/")).toBe("open");
        expect(rebase.addClient).toHaveBeenCalledTimes(1);
    });

    it("an upgrade nothing else claims is answered 404, not left hanging", async () => {
        const server = createServer();
        const rebase = rebaseSocketOn(server);
        const port = await listen(server);

        expect(await answer(port, "/elsewhere")).toBe("refused 404");
        expect(rebase.addClient).not.toHaveBeenCalled();
        expect(await answer(port, "/")).toBe("open");
    });

    it("answers on the configured path, ignoring a trailing slash and the query", async () => {
        const server = createServer();
        const rebase = rebaseSocketOn(server, "/app");
        const port = await listen(server);

        for (const path of ["/app", "/app/", "/app?rebase_caps=heartbeat"]) {
            expect([path, await answer(port, path)]).toEqual([path, "open"]);
        }
        for (const path of ["/", "/application", "/app/api"]) {
            expect([path, await answer(port, path)]).toEqual([path, "refused 404"]);
        }
        expect(rebase.addClient).toHaveBeenCalledTimes(3);
    });

    it("behind a dispatcher that lifts its listener and re-dispatches what it does not claim", async () => {
        // The shape of the cloud control plane's `attachWsUpgradeRoutes`:
        // every listener already on the server is taken off, and an upgrade
        // no route claims is handed to them — so the socket's listener runs
        // while it is not registered, and the dispatcher is the only one.
        const server = createServer();
        const rebase = rebaseSocketOn(server);

        const studio = new WebSocketServer({ noServer: true });
        studio.on("connection", (socket) => socket.send("studio-hello"));
        const inherited = server.listeners("upgrade") as Array<(req: IncomingMessage, socket: Duplex, head: Buffer) => void>;
        server.removeAllListeners("upgrade");
        server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
            if (request.url?.startsWith("/studio/")) {
                studio.handleUpgrade(request, socket, head, (client) => studio.emit("connection", client, request));
                return;
            }
            for (const listener of inherited) listener.call(server, request, socket, head);
        });
        const port = await listen(server);

        const bridged = await dial(port, "/studio/abc");
        expect(bridged.kind).toBe("open");
        if (bridged.kind === "open") expect(await withTimeout(bridged.firstMessage, "<nothing>")).toBe("studio-hello");

        expect(await answer(port, "/")).toBe("open");
        expect(rebase.addClient).toHaveBeenCalledTimes(1);

        expect(await answer(port, "/nope")).toBe("refused 404");
    });

    it("the Postgres adapter's realtime.path wins over the path the server derived", async () => {
        const server = createServer();
        const { addClient, realtime, driver } = stubs();
        await createPostgresBootstrapper({ realtime: { path: "/live" } })
            .initializeWebsockets!(server, realtime, driver, { requireAuth: false }, undefined, { path: "/" });
        const port = await listen(server);

        expect(await answer(port, "/live")).toBe("open");
        expect(await answer(port, "/")).toBe("refused 404");
        expect(addClient).toHaveBeenCalledTimes(1);
    });
});
