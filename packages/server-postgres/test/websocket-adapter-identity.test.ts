import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import type { Server } from "http";
import type { AuthAdapter } from "@rebasepro/types";

let mockWssInstance: { on: jest.Mock } | null = null;

jest.mock("ws", () => ({
    WebSocketServer: jest.fn().mockImplementation(() => {
        mockWssInstance = { on: jest.fn() };
        return mockWssInstance;
    }),
    WebSocket: jest.fn()
}));

import { createPostgresWebSocket } from "../src/websocket";
import type { RealtimeService } from "../src/services/realtimeService";
import type { PostgresBackendDriver } from "../src/PostgresBackendDriver";

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
    let scopedAs: Record<string, unknown>[];

    const connect = () => {
        const connection = mockWssInstance!.on.mock.calls.find((call) => call[0] === "connection")![1] as (ws: unknown) => void;
        const ws = { on: jest.fn(), send: jest.fn() };
        connection(ws);
        const onMessage = ws.on.mock.calls.find((call) => call[0] === "message")![1] as (data: Buffer) => Promise<void>;
        const send = (message: unknown) => onMessage(Buffer.from(JSON.stringify(message)));
        const frames = () => ws.send.mock.calls.map((call) => JSON.parse(call[0] as string));
        return { send, frames };
    };

    function start(adapterUser: Record<string, unknown>) {
        scopedAs = [];
        const driver = {
            key: "postgres",
            initialised: true,
            fetchCollection: jest.fn(async () => []),
            withAuth: jest.fn(async (user: Record<string, unknown>) => {
                scopedAs.push(user);
                return driver;
            })
        } as unknown as PostgresBackendDriver;
        const realtime = { addClient: jest.fn(), startDataDriverSubscription: jest.fn() } as unknown as RealtimeService;
        const adapter = { verifyToken: async () => adapterUser, verifyRequest: async () => null } as unknown as AuthAdapter;
        createPostgresWebSocket({} as Server, realtime, driver, { requireAuth: true }, adapter);
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
});
