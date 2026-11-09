import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import type { Server } from "http";
import type { AuthenticatedUser, User } from "@rebasepro/types";

let mockWssInstance: { on: jest.Mock; clients: Set<unknown> } | null = null;

jest.mock("ws", () => ({
    WebSocketServer: jest.fn().mockImplementation(() => {
        mockWssInstance = { on: jest.fn(), clients: new Set() };
        return mockWssInstance;
    }),
    WebSocket: jest.fn()
}));

import { createPostgresWebSocket } from "../src/websocket";
import type { SocketDataDriver } from "../src/websocket";
import { fakeAuthAdapter, fakeDataDriver, fakeSocketRealtime } from "./helpers/spg-c-socket";

/**
 * The socket reads and writes as the principal an auth adapter verified —
 * custom claims included.
 *
 * The JWT branch of `AUTHENTICATE` kept the token's `claims` on the session;
 * the adapter branch, which is the one every backend with a `config.auth`
 * object takes (the built-in auth is an adapter), rebuilt the identity from
 * `uid`, `roles`, `isAdmin` and `isAnonymous`. A claim-tenanted collection
 * (`tenant: { from: { claim: "org_id" } }`) then had no tenant on any socket
 * frame: reads came back empty and creates failed with `TENANT_REQUIRED`,
 * while the same request over HTTP worked.
 */
describe("WebSocket Server identity from an auth adapter", () => {
    let scopedAs: User[];

    const connect = () => {
        const connection = mockWssInstance!.on.mock.calls.find((call) => call[0] === "connection")![1] as (ws: unknown) => void;
        const ws = { on: jest.fn(), send: jest.fn() };
        connection(ws);
        const onMessage = ws.on.mock.calls.find((call) => call[0] === "message")![1] as (data: Buffer) => Promise<void>;
        const send = (message: unknown) => onMessage(Buffer.from(JSON.stringify(message)));
        const frames = () => ws.send.mock.calls.map((call) => JSON.parse(call[0] as string));
        return { send, frames };
    };

    function start(adapterUser: AuthenticatedUser, options?: Parameters<typeof createPostgresWebSocket>[5]) {
        scopedAs = [];
        const base = fakeDataDriver();
        base.fetchCollection.mockResolvedValue([]);
        const driver: SocketDataDriver = {
            ...base,
            withAuth: async (user) => {
                scopedAs.push(user);
                return driver;
            }
        };
        const adapter = fakeAuthAdapter({ verifyToken: async () => adapterUser });
        createPostgresWebSocket({} as Server, fakeSocketRealtime(), driver, { requireAuth: true }, adapter, options);
    }

    beforeEach(() => {
        mockWssInstance = null;
    });

    it("scopes a request frame with the claims the adapter returned", async () => {
        start({ uid: "member-1", email: "", roles: ["editor"], isAdmin: false, claims: { org_id: "acme" } });
        const { send, frames } = connect();

        await send({ type: "AUTHENTICATE", requestId: "auth", payload: { token: "t" } });
        expect(frames()[0]).toEqual(expect.objectContaining({ type: "AUTH_SUCCESS" }));

        await send({ type: "FETCH_COLLECTION", requestId: "fetch", payload: { path: "projects" } });

        expect(scopedAs).toEqual([expect.objectContaining({ uid: "member-1", claims: { org_id: "acme" } })]);
    });

    it("adds no claims key when the adapter returned none", async () => {
        start({ uid: "member-1", email: "", roles: ["editor"], isAdmin: false });
        const { send } = connect();

        await send({ type: "AUTHENTICATE", requestId: "auth", payload: { token: "t" } });
        await send({ type: "FETCH_COLLECTION", requestId: "fetch", payload: { path: "projects" } });

        expect(scopedAs).toHaveLength(1);
        expect(scopedAs[0]).not.toHaveProperty("claims");
    });

    it("scopes an API key's frames with the key named, so a callback can tell it from its owner", async () => {
        start({ uid: "unused", email: "", roles: [], isAdmin: false }, {
            resolveApiKey: async () => ({
                uid: "ada",
                roles: ["editor"],
                scopes: ["data:read"],
                apiKey: { id: "key-1", rate_limit: null, name: "CI deploys", kind: "personal" }
            })
        });
        const { send } = connect();

        await send({ type: "AUTHENTICATE", requestId: "auth", payload: { token: "rk_live_x" } });
        await send({ type: "FETCH_COLLECTION", requestId: "fetch", payload: { path: "projects" } });

        expect(scopedAs).toEqual([expect.objectContaining({
            uid: "ada",
            credential: { kind: "personal", id: "key-1", name: "CI deploys" }
        })]);
    });

    it("names no credential for a session", async () => {
        start({ uid: "ada", email: "", roles: ["editor"], isAdmin: false });
        const { send } = connect();

        await send({ type: "AUTHENTICATE", requestId: "auth", payload: { token: "t" } });
        await send({ type: "FETCH_COLLECTION", requestId: "fetch", payload: { path: "projects" } });

        expect(scopedAs[0]).not.toHaveProperty("credential");
    });
});
