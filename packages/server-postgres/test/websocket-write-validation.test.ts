import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { Server } from "http";

let mockWssInstance: any = null;

jest.mock("ws", () => ({
    WebSocketServer: jest.fn().mockImplementation(() => {
        const instance = { on: jest.fn() };
        mockWssInstance = instance;
        return instance;
    }),
    WebSocket: jest.fn()
}));

/**
 * The real validator and the real `ApiError`, deliberately.
 *
 * The claim under test is that this socket and the HTTP write routes refuse the
 * same payload, and a stubbed validator could only show that *something* was
 * called. `websocket.test.ts` keeps `resolveRequireAuth` real for the same
 * reason, and says so.
 */
jest.mock("@rebasepro/server", () => ({
    extractUserFromToken: () => ({ uid: "u-1", roles: [] }),
    safeCompare: (a: string, b: string) => a === b,
    logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    resolveRequireAuth: require("../../server/src/auth/require-auth").resolveRequireAuth,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    assertWriteRequestValid: require("../../server/src/api/rest/write-validation").assertWriteRequestValid,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ApiError: require("../../server/src/api/errors").ApiError
}));

import { createPostgresWebSocket } from "../src/websocket";
import { RealtimeService } from "../src/services/realtimeService";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";

/**
 * A write arriving over the socket used to skip the checks the REST routes run.
 *
 * `assertKnownWriteFields` and `assertWriteValuesValid` were called from
 * `api-generator.ts` and nowhere else, and the socket's `SAVE` handler took the
 * client's payload straight to `driver.save`. So one door answered
 * `PATCH /api/data/users/1 { age: 999 }` with a 400 naming the rule, and the
 * other wrote it — and the admin panel writes through the socket.
 *
 * The socket's own `requireAuth` comment already called it "the other
 * enforcement point for one product decision", after it had diverged on that
 * one too.
 */
describe("a write over the socket meets the same rules as a write over HTTP", () => {
    let mockServer: Server;
    let mockRealtimeService: RealtimeService;
    let mockDriver: PostgresBackendDriver;
    let saved: unknown[];

    /** The collection the *registry* answers with — the authoritative one. */
    const usersCollection = {
        slug: "users",
        name: "Users",
        table: "users",
        properties: {
            id: { name: "ID", type: "string", isId: true },
            age: { name: "Age", type: "number", validation: { max: 120 } },
            handle: { name: "Handle", type: "string", validation: { matches: "^[a-z]+$" } }
        }
    };

    const connect = () => {
        const handlers: Record<string, (...args: any[]) => any> = {};
        const ws = {
            send: jest.fn(),
            on: (event: string, cb: (...args: any[]) => any) => { handlers[event] = cb; },
            readyState: 1,
            close: jest.fn()
        };
        const connection = mockWssInstance.on.mock.calls.find((c: any[]) => c[0] === "connection");
        connection[1](ws, { url: "/", headers: {} });
        return { ws, send: (msg: unknown) => handlers.message(JSON.stringify(msg)) };
    };

    const lastFrame = (ws: any) =>
        JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0]);

    beforeEach(() => {
        jest.clearAllMocks();
        mockWssInstance = null;
        saved = [];

        mockDriver = {
            key: "postgres",
            initialised: true,
            registry: {
                getCollectionByPath: (path: string) => (path === "users" ? usersCollection : undefined)
            },
            save: async (props: unknown) => { saved.push(props); return {}; },
            withAuth: undefined
        } as unknown as PostgresBackendDriver;

        mockRealtimeService = {
            addClient: jest.fn(),
            registerDataDriverSubscription: jest.fn()
        } as unknown as RealtimeService;

        createPostgresWebSocket(mockServer = {} as Server, mockRealtimeService, mockDriver, {
            requireAuth: false
        });
    });

    const save = (values: Record<string, unknown>, collection?: unknown) => ({
        type: "SAVE",
        requestId: "r-1",
        payload: { path: "users", values, ...(collection === undefined ? {} : { collection }) }
    });

    it("refuses a value the collection's rule rejects, instead of writing it", async () => {
        const { ws, send } = connect();

        await send(save({ age: 999 }));

        expect(saved).toEqual([]);
        expect(lastFrame(ws)).toMatchObject({
            type: "ERROR",
            payload: { error: { code: "VALIDATION_CONSTRAINT" } }
        });
    });

    it("keeps the message, which is the only thing that says what to send instead", async () => {
        const { ws, send } = connect();

        await send(save({ handle: "NotLowercase" }));

        expect(lastFrame(ws).payload.error.message).toMatch(/handle/);
    });

    it("refuses a field the collection does not declare", async () => {
        const { ws, send } = connect();

        await send(save({ nonsense: 1 }));

        expect(saved).toEqual([]);
        expect(lastFrame(ws)).toMatchObject({
            payload: { error: { code: "VALIDATION_UNKNOWN_FIELDS" } }
        });
    });

    it("reads the rules from the registry, not from the payload's own collection", async () => {
        // The trap in doing this at all: `SaveProps` carries a `collection`,
        // and it is client-supplied. Reading the rules out of it would let a
        // caller send an empty properties map and choose to be unvalidated.
        const { ws, send } = connect();

        await send(save({ age: 999 }, { slug: "users", table: "users", properties: {} }));

        expect(saved).toEqual([]);
        expect(lastFrame(ws).payload.error.code).toBe("VALIDATION_CONSTRAINT");
    });

    it("writes a payload that satisfies the rules", async () => {
        const { send } = connect();

        await send(save({ age: 30, handle: "ada" }));

        expect(saved).toHaveLength(1);
    });

    it("says nothing about a path the registry does not know", async () => {
        // Unknown collection is the driver's question to answer, and refusing
        // here would turn it into a validation error.
        const { send } = connect();

        await send({ type: "SAVE", requestId: "r-2", payload: { path: "unknown", values: { x: 1 } } });

        expect(saved).toHaveLength(1);
    });
});
