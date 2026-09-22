/**
 * A read that arrives over the socket may not name a field its caller cannot
 * read — the rule `GET /api/data` already applies (`FIELD_NOT_READABLE`).
 *
 * The row strip keeps a withheld value off the wire; this is the other half.
 * Without it the value is still readable a predicate at a time: `COUNT` with
 * `{ passwordHash: ["like", "$2b$10$A%"] }` answers 1 or 0, and a caller walks a
 * hash out one character per frame. `FETCH_COLLECTION` and `subscribe_collection`
 * answer the same question with rows instead of a number, `orderBy` answers it
 * with a ranking, and `CHECK_UNIQUE_FIELD` answers "does anybody hold this
 * value" outright.
 *
 * The real socket, the real realtime service and the real REST rule: the claim
 * is that the two boundaries refuse the same request, which stubbed checks could
 * not show.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { Server } from "http";
import type { AuthAdapter, CollectionConfig } from "@rebasepro/types";

let mockWssInstance: { on: jest.Mock } | null = null;

// Only the server is replaced — the realtime service compares `readyState`
// against the real `WebSocket.OPEN`.
jest.mock("ws", () => ({
    ...jest.requireActual<typeof import("ws")>("ws"),
    WebSocketServer: jest.fn().mockImplementation(() => {
        const instance = { on: jest.fn() };
        mockWssInstance = instance;
        return instance;
    })
}));

import { createPostgresWebSocket } from "../src/websocket";
import { RealtimeService } from "../src/services/realtimeService";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

const staff = {
    name: "Staff",
    slug: "staff",
    table: "staff",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        name: { name: "Name", type: "string" },
        salary: { name: "Salary", type: "number", access: { read: ["hr"] } },
        passwordHash: { name: "Password hash", type: "string", columnName: "password_hash", excludeFromApi: true }
    }
} as unknown as CollectionConfig;

type Frame = { type: string; requestId?: string; payload?: { error?: { code?: string; message?: string } } };

describe("the socket's request frames", () => {
    let driver: {
        registry: { getCollectionByPath: (path: string) => CollectionConfig | undefined };
        fetchCollection: jest.Mock;
        count: jest.Mock;
        checkUniqueField: jest.Mock;
    };

    /**
     * Signs a socket in with the roles its token names, through the adapter
     * branch — no JWT to mint, and the roles are the only thing under test.
     */
    const adapter = {
        verifyToken: async (token: string) => ({
            uid: `u-${token}`,
            roles: token.split(","),
            isAdmin: token.split(",").includes("admin"),
            isAnonymous: false
        })
    } as unknown as AuthAdapter;

    const connect = async (roles: string[]) => {
        const handlers: Record<string, (raw: Buffer) => Promise<void>> = {};
        const ws = {
            send: jest.fn(),
            on: (event: string, cb: (raw: Buffer) => Promise<void>) => { handlers[event] = cb; },
            readyState: 1,
            close: jest.fn()
        };
        const connection = mockWssInstance!.on.mock.calls.find(call => call[0] === "connection")!;
        (connection[1] as (socket: unknown) => void)(ws);
        const send = (message: unknown) => handlers.message(Buffer.from(JSON.stringify(message)));
        await send({ type: "AUTHENTICATE", requestId: "auth", payload: { token: roles.join(",") } });
        return { ws, send };
    };

    const lastFrame = (ws: { send: jest.Mock }): Frame =>
        JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0] as string);

    beforeEach(() => {
        jest.clearAllMocks();
        mockWssInstance = null;
        driver = {
            registry: { getCollectionByPath: (path: string) => (path === "staff" ? staff : undefined) },
            fetchCollection: jest.fn(async () => []),
            count: jest.fn(async () => 1),
            checkUniqueField: jest.fn(async () => false)
        };
        createPostgresWebSocket(
            {} as Server,
            { addClient: jest.fn() } as unknown as RealtimeService,
            driver as unknown as PostgresBackendDriver,
            undefined,
            adapter
        );
    });

    const refusedFor = (frame: Frame, field: string) => {
        expect(frame.type).toBe("ERROR");
        expect(frame.payload?.error?.code).toBe("FIELD_NOT_READABLE");
        expect(frame.payload?.error?.message).toContain(`'${field}'`);
    };

    it("refuses a COUNT filtered on an excludeFromApi field", async () => {
        const { ws, send } = await connect(["user"]);
        await send({ type: "COUNT", requestId: "c", payload: { path: "staff", filter: { passwordHash: ["like", "$2b$10$A%"] } } });
        refusedFor(lastFrame(ws), "passwordHash");
        expect(driver.count).not.toHaveBeenCalled();
    });

    it("refuses it by the column's own name too", async () => {
        const { ws, send } = await connect(["user"]);
        await send({ type: "COUNT", requestId: "c", payload: { path: "staff", filter: { password_hash: ["like", "a%"] } } });
        refusedFor(lastFrame(ws), "password_hash");
        expect(driver.count).not.toHaveBeenCalled();
    });

    it("refuses a FETCH_COLLECTION filtered, grouped, sorted or projected on a role-restricted field", async () => {
        const { ws, send } = await connect(["user"]);
        const requests = [
            { filter: { salary: [">", 100] } },
            { logical: { type: "or", conditions: [{ column: "name", operator: "==", value: "ann" }, { column: "salary", operator: ">", value: 1 }] } },
            { orderBy: "salary", order: "desc" },
            { orderBy: [["name", "asc"], ["salary", "desc"]] },
            { fields: ["name", "salary"] }
        ];
        for (const request of requests) {
            await send({ type: "FETCH_COLLECTION", requestId: "f", payload: { path: "staff", ...request } });
            refusedFor(lastFrame(ws), "salary");
        }
        expect(driver.fetchCollection).not.toHaveBeenCalled();
    });

    it("refuses a CHECK_UNIQUE_FIELD on a field the caller cannot read", async () => {
        const { ws, send } = await connect(["user"]);
        await send({ type: "CHECK_UNIQUE_FIELD", requestId: "u", payload: { path: "staff", name: "passwordHash", value: "hash-a" } });
        refusedFor(lastFrame(ws), "passwordHash");
        expect(driver.checkUniqueField).not.toHaveBeenCalled();
    });

    it("serves a read that names only readable fields", async () => {
        const { ws, send } = await connect(["user"]);
        await send({ type: "FETCH_COLLECTION", requestId: "f", payload: { path: "staff", filter: { name: ["==", "ann"] }, orderBy: "name" } });
        expect(lastFrame(ws).type).toBe("FETCH_COLLECTION_SUCCESS");
        await send({ type: "COUNT", requestId: "c", payload: { path: "staff", filter: { name: ["==", "ann"] } } });
        expect(lastFrame(ws).type).toBe("COUNT_SUCCESS");
    });

    it("serves the role-restricted field to a caller holding the role, and to admin", async () => {
        for (const roles of [["hr"], ["admin"]]) {
            const { ws, send } = await connect(roles);
            await send({ type: "COUNT", requestId: "c", payload: { path: "staff", filter: { salary: [">", 100] } } });
            expect(lastFrame(ws).type).toBe("COUNT_SUCCESS");
        }
    });

    it("refuses the excludeFromApi field to admin as well", async () => {
        const { ws, send } = await connect(["admin"]);
        await send({ type: "FETCH_COLLECTION", requestId: "f", payload: { path: "staff", orderBy: "passwordHash" } });
        refusedFor(lastFrame(ws), "passwordHash");
    });
});

describe("subscribe_collection", () => {
    let realtime: RealtimeService;
    let ws: { readyState: number; send: jest.Mock; on: jest.Mock };

    beforeEach(() => {
        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple([staff]);
        // No database: a refused subscription never reaches one, and the
        // allowed case below only asserts that it got past the check.
        realtime = new RealtimeService({} as never, registry);
        ws = { readyState: 1, send: jest.fn(), on: jest.fn() };
        realtime.addClient("c1", ws as never);
    });

    const subscribe = (payload: Record<string, unknown>) =>
        realtime.handleClientMessage("c1", {
            type: "subscribe_collection",
            payload: { path: "staff", subscriptionId: "s1", ...payload }
        }, { uid: "u1", roles: ["user"] });

    const frames = (): { type: string; payload?: { error?: { code?: string } } }[] =>
        ws.send.mock.calls.map(call => JSON.parse(call[0] as string));

    it("refuses a subscription filtered on a field the subscriber cannot read, and stores nothing", async () => {
        await subscribe({ filter: { passwordHash: ["like", "$2b$10$A%"] } });
        expect(frames()).toEqual([
            expect.objectContaining({ type: "error", payload: expect.objectContaining({ error: expect.objectContaining({ code: "FIELD_NOT_READABLE" }) }) })
        ]);
        expect(realtime.subscriptions.has("s1")).toBe(false);
    });

    it("refuses one sorted on a role-restricted field", async () => {
        await subscribe({ orderBy: "salary" });
        expect(frames()[0]?.payload?.error?.code).toBe("FIELD_NOT_READABLE");
        expect(realtime.subscriptions.has("s1")).toBe(false);
    });

    it("stores one that names only readable fields", async () => {
        await subscribe({ filter: { name: ["==", "ann"] } });
        expect(realtime.subscriptions.has("s1")).toBe(true);
    });
});
