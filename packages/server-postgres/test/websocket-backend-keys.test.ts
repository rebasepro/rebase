/**
 * A socket built for a backend verifies sessions with that backend's keys and
 * reads that backend's roles.
 *
 * The server hands the socket `verifyAccessToken` and `accessModel` in its
 * options. Without an auth adapter, those are the whole answer to "who is this
 * token, and what do their roles hold" — the process default's JWT
 * configuration and access model, which the socket used to read, belong to
 * whichever backend was installed last, not to this one.
 *
 * Real sockets on a real `http.Server`; the realtime service is a stand-in.
 */
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import type { AccessModel } from "@rebasepro/types";
import { configureAccess, configureJwt } from "@rebasepro/server";
import { generateAccessToken } from "../../server/src/auth/jwt";
import { EMPTY_ACCESS_MODEL } from "@rebasepro/types";
import { createPostgresWebSocket } from "../src/websocket";
import type { RealtimeService } from "../src/services/realtimeService";
import type { PostgresBackendDriver } from "../src/PostgresBackendDriver";

const servers: Server[] = [];

afterEach(async () => {
    for (const server of servers.splice(0)) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    configureAccess({ model: EMPTY_ACCESS_MODEL });
});

function realtimeStub(): RealtimeService {
    return {
        addClient: jest.fn(),
        removeClient: jest.fn(),
        handleClientMessage: jest.fn(async () => undefined),
        rescopeClient: jest.fn(async () => undefined)
    } as unknown as RealtimeService;
}

/** A driver whose SQL admin answers, so `EXECUTE_SQL` reaches the scope check and past it. */
function driverStub(): PostgresBackendDriver {
    return {
        key: "postgres",
        initialised: true,
        admin: { executeSql: jest.fn(async () => [{ ok: 1 }]) }
    } as unknown as PostgresBackendDriver;
}

async function socketFor(options: {
    verifyAccessToken: (token: string) => Promise<{ uid: string; roles?: string[] } | null>;
    accessModel: AccessModel;
}): Promise<number> {
    const server = createServer();
    servers.push(server);
    createPostgresWebSocket(server, realtimeStub(), driverStub(), { requireAuth: true }, undefined, options);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    return (server.address() as AddressInfo).port;
}

/** Send `frames` in order on one socket and collect a reply's type per frame. */
function converse(port: number, frames: Array<Record<string, unknown>>): Promise<string[]> {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
        const replies: string[] = [];
        const timer = setTimeout(() => {
            socket.terminate();
            reject(new Error(`stalled after ${JSON.stringify(replies)}`));
        }, 5000);
        socket.once("error", reject);
        socket.once("open", () => socket.send(JSON.stringify(frames[0])));
        socket.on("message", (data) => {
            const message = JSON.parse(String(data)) as { type?: string; error?: { code?: string }; payload?: { error?: { code?: string } } };
            if (message.type === "HEARTBEAT") return;
            const code = message.payload?.error?.code ?? message.error?.code;
            replies.push(code ? `${message.type}:${code}` : String(message.type));
            const next = frames[replies.length];
            if (next) {
                socket.send(JSON.stringify(next));
            } else {
                clearTimeout(timer);
                socket.terminate();
                resolve(replies);
            }
        });
    });
}

const authenticate = (token: string) => ({ type: "AUTHENTICATE", requestId: "auth", payload: { token } });
const executeSql = { type: "EXECUTE_SQL", requestId: "sql", payload: { sql: "SELECT 1" } };

describe("the socket a backend builds answers for that backend", () => {
    it("verifies a session with the keys it was handed, not the process default's", async () => {
        configureJwt({ secret: "process-default-secret-0123456789abcdef-01234" });
        const processToken = await generateAccessToken("u1", []);
        const port = await socketFor({
            verifyAccessToken: async (token) => (token === "backend-token" ? { uid: "u1", roles: [] } : null),
            accessModel: EMPTY_ACCESS_MODEL
        });

        expect(await converse(port, [authenticate("backend-token")])).toEqual(["AUTH_SUCCESS"]);
        // A token the process default would honour means nothing here.
        expect(await converse(port, [authenticate(processToken)])).toEqual(["AUTH_ERROR:INVALID_TOKEN"]);
    });

    it("reads what a role holds from the access model it was handed", async () => {
        const ops: AccessModel = { roles: { ops: { scopes: ["database:write"] } }, scopes: {} };
        // The process default grants `ops` the console; the backend does not.
        configureAccess({ model: ops });
        const withoutOps = await socketFor({
            verifyAccessToken: async () => ({ uid: "u1", roles: ["ops"] }),
            accessModel: EMPTY_ACCESS_MODEL
        });
        const [, refused] = await converse(withoutOps, [authenticate("t"), executeSql]);
        expect(refused).toBe("ERROR:SCOPE_MISSING");

        // And the other way round: the backend grants it, the default does not.
        configureAccess({ model: EMPTY_ACCESS_MODEL });
        const withOps = await socketFor({
            verifyAccessToken: async () => ({ uid: "u1", roles: ["ops"] }),
            accessModel: ops
        });
        const [, answered] = await converse(withOps, [authenticate("t"), executeSql]);
        expect(answered).toBe("EXECUTE_SQL_SUCCESS");
    });
});
