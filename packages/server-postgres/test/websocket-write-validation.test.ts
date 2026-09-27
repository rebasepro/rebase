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
 * The real validator and the real `declaredErrorAnswer`, deliberately.
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
    assertFieldOpsValid: require("../../server/src/api/rest/field-ops").assertFieldOpsValid,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    splitFieldOps: require("../../server/src/api/rest/field-ops").splitFieldOps,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    declaredErrorAnswer: require("../../server/src/api/errors").declaredErrorAnswer,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ApiError: require("../../server/src/api/errors").ApiError,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    resolveConflictTarget: require("../../server/src/api/rest/conflict-target").resolveConflictTarget,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    assertNestedWriteAllowed: require("../../server/src/api/rest/nested-write-access").assertNestedWriteAllowed
}));

import type { AuthAdapter, CollectionConfig } from "@rebasepro/types";
import { createPostgresWebSocket } from "../src/websocket";
import { RealtimeService } from "../src/services/realtimeService";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

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
            handle: { name: "Handle", type: "string", validation: { matches: "^[a-z]+$" } },
            email: { name: "Email", type: "string", validation: { unique: true } }
        }
    };

    /** A collection with a required field, for the create-time check. */
    const profilesCollection = {
        slug: "profiles",
        name: "Profiles",
        table: "profiles",
        properties: {
            id: { name: "ID", type: "string", isId: true },
            handle: { name: "Handle", type: "string", validation: { required: true } },
            bio: { name: "Bio", type: "string" }
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
                getCollectionByPath: (path: string) => (path === "users" ? usersCollection : path === "profiles" ? profilesCollection : undefined)
            },
            save: async (props: unknown) => { saved.push(props); return {}; },
            withAuth: undefined
        } as unknown as PostgresBackendDriver;

        mockRealtimeService = {
            addClient: jest.fn(),
            startDataDriverSubscription: jest.fn()
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

    it("refuses a field operation the property type does not define", async () => {
        // The other half of the parity claim, on the feature added after it:
        // `PATCH` answers 400 for `$push` on a number, and this door has to
        // agree. The operators themselves reach the driver either way — they
        // are compiled in `PersistService`, which both doors go through — so
        // without this check the socket would *accept* the illegal one and
        // fail on a Postgres type error inside the transaction.
        const { ws, send } = connect();

        await send(save({ age: { $push: 1 } }));

        expect(saved).toEqual([]);
        expect(lastFrame(ws)).toMatchObject({
            type: "ERROR",
            payload: { error: { code: "INVALID_FIELD_OPERATION" } }
        });
    });

    it("passes a legal field operation through to the driver", async () => {
        const { send } = connect();

        await send(save({ age: { $inc: 1 } }));

        expect(saved).toHaveLength(1);
        expect(saved[0]).toMatchObject({ values: { age: { $inc: 1 } } });
    });

    it("refuses a create missing a required field, naming it, before the driver runs", async () => {
        // The REST create answers VALIDATION_CONSTRAINT. Validated without the
        // status, the socket left `required` to the INSERT's NOT NULL error.
        const { ws, send } = connect();

        await send({ type: "SAVE", requestId: "r-7", payload: { path: "profiles", status: "new", values: { bio: "x" } } });

        expect(saved).toEqual([]);
        expect(lastFrame(ws)).toMatchObject({ type: "ERROR", payload: { error: { code: "VALIDATION_CONSTRAINT" } } });
        expect(lastFrame(ws).payload.error.message).toMatch(/handle/);

        // An update names only what it changes.
        await send({ type: "SAVE", requestId: "r-8", payload: { path: "profiles", id: "p-1", status: "existing", values: { bio: "y" } } });
        expect(saved).toHaveLength(1);
    });

    it("hands the driver the address, the values and the status — nothing else the frame says", async () => {
        // `collection` was merged under the registry's in the driver, so a key
        // the registry leaves unset was the caller's: `{ history: true }`
        // recorded history for a collection that declares none. The DELETE
        // frame was narrowed the same way for `softDelete`.
        const { send } = connect();

        await send({
            type: "SAVE",
            requestId: "r-3",
            payload: {
                path: "users",
                id: "u-1",
                status: "existing",
                values: { age: 30 },
                collection: { slug: "users", history: true },
                previousValues: { age: 1 }
            }
        });

        expect(saved).toEqual([{ path: "users", id: "u-1", status: "existing", values: { age: 30 } }]);
    });

    it("refuses an upsert through a parent, which would move the row it matched under that parent", async () => {
        // `POST /owners/1/docs?on_conflict=…` is refused for this reason; the
        // insert branch stamps the parent's key into the DO UPDATE, so Bob's
        // doc 10 became owner 1's.
        const { ws, send } = connect();

        await send({
            type: "SAVE",
            requestId: "r-4",
            payload: { path: "owners/1/docs", status: "new", upsert: true, values: { id: 10, title: "x" } }
        });

        expect(saved).toEqual([]);
        expect(lastFrame(ws)).toMatchObject({ type: "ERROR", payload: { error: { code: "INVALID_CONFLICT_TARGET" } } });
    });

    it("refuses a conflict target that carries no uniqueness guarantee", async () => {
        // Unchecked, it reached Postgres as 42P10 and came back a server fault.
        const { ws, send } = connect();

        await send({
            type: "SAVE",
            requestId: "r-5",
            payload: { path: "users", status: "new", upsert: true, onConflict: ["age"], values: { age: 30 } }
        });

        expect(saved).toEqual([]);
        expect(lastFrame(ws)).toMatchObject({ type: "ERROR", payload: { error: { code: "INVALID_CONFLICT_TARGET" } } });
    });

    it("passes an upsert on a declared unique target through", async () => {
        const { send } = connect();

        await send({
            type: "SAVE",
            requestId: "r-6",
            payload: { path: "users", status: "new", upsert: true, onConflict: ["email"], values: { email: "a@b.c" } }
        });

        expect(saved).toEqual([{ path: "users", status: "new", values: { email: "a@b.c" }, upsert: true, onConflict: ["email"] }]);
    });

    it("says nothing about a path the registry does not know", async () => {
        // Unknown collection is the driver's question to answer, and refusing
        // here would turn it into a validation error.
        const { send } = connect();

        await send({ type: "SAVE", requestId: "r-2", payload: { path: "unknown", values: { x: 1 } } });

        expect(saved).toHaveLength(1);
    });
});

/**
 * A write through a parent writes the parent's relation, and for a child that
 * carries the parent's key, that key — which is not in the body the checks
 * above read. The REST nested routes ask `assertNestedWriteAllowed`; so does
 * this door.
 */
describe("a socket write through a parent's relation", () => {
    const members = {
        slug: "members", name: "Members", table: "members",
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            name: { name: "Name", type: "string" },
            band: { name: "Band", type: "relation", access: { write: ["hr"] }, relation: { kind: "belongsTo", target: () => bands, localKey: "band_id" } }
        }
    } as unknown as CollectionConfig;
    const bands: CollectionConfig = {
        slug: "bands", name: "Bands", table: "bands",
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            name: { name: "Name", type: "string" },
            members: { name: "Members", type: "relation", relation: { kind: "hasMany", target: () => members, foreignKeyOnTarget: "band_id" } }
        }
    } as unknown as CollectionConfig;
    const tags = {
        slug: "tags", name: "Tags", table: "tags",
        properties: { id: { name: "ID", type: "number", isId: "increment" }, name: { name: "Name", type: "string" } }
    } as unknown as CollectionConfig;
    const posts = {
        slug: "posts", name: "Posts", table: "posts",
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            tags: {
                name: "Tags", type: "relation", access: { write: ["editor"] },
                relation: { kind: "manyToMany", target: () => tags, through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" } }
            }
        }
    } as unknown as CollectionConfig;

    let writes: unknown[];

    const adapter = {
        verifyToken: async (token: string) => ({ uid: `u-${token}`, roles: token.split(","), isAdmin: false })
    } as unknown as AuthAdapter;

    const connect = async (roles: string[]) => {
        const handlers: Record<string, (...args: any[]) => any> = {};
        const ws = {
            send: jest.fn(),
            on: (event: string, cb: (...args: any[]) => any) => { handlers[event] = cb; },
            readyState: 1,
            close: jest.fn()
        };
        mockWssInstance.on.mock.calls.find((c: any[]) => c[0] === "connection")[1](ws, { url: "/", headers: {} });
        const send = (msg: unknown) => handlers.message(JSON.stringify(msg));
        await send({ type: "AUTHENTICATE", requestId: "auth", payload: { token: roles.join(",") } });
        const last = () => JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0]);
        return { send, last };
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockWssInstance = null;
        writes = [];
        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple([bands, members, posts, tags]);
        const driver = {
            key: "postgres",
            initialised: true,
            registry,
            save: async (props: unknown) => { writes.push(props); return {}; },
            delete: async (props: unknown) => { writes.push(props); },
            withAuth: undefined
        } as unknown as PostgresBackendDriver;
        createPostgresWebSocket({} as Server, { addClient: jest.fn() } as unknown as RealtimeService, driver, undefined, adapter);
    });

    const expectRefused = (frame: { type: string; payload: { error: { code: string; message: string } } }, field: string) => {
        expect(frame.type).toBe("ERROR");
        expect(frame.payload.error.code).toBe("FIELD_NOT_WRITABLE");
        expect(frame.payload.error.message).toContain(`'${field}'`);
    };

    it("refuses a create under a parent whose key the caller may not set on the child", async () => {
        const { send, last } = await connect(["viewer"]);
        await send({ type: "SAVE", requestId: "s", payload: { path: "bands/7/members", status: "new", values: { name: "x" } } });
        expectRefused(last(), "bandId");
        expect(writes).toEqual([]);
    });

    it("refuses a many-to-many link, made or dropped, the caller may not write", async () => {
        const { send, last } = await connect(["viewer"]);
        await send({ type: "SAVE", requestId: "a", payload: { path: "posts/1/tags", status: "new", values: { name: "new" } } });
        expectRefused(last(), "tags");
        await send({ type: "SAVE", requestId: "b", payload: { path: "posts/1/tags", id: 5, status: "existing", values: { name: "same" } } });
        expectRefused(last(), "tags");
        await send({ type: "DELETE", requestId: "c", payload: { row: { path: "posts/1/tags", id: 5 } } });
        expectRefused(last(), "tags");
        expect(writes).toEqual([]);
    });

    it("lets a caller holding the roles make them", async () => {
        const { send } = await connect(["hr", "editor"]);
        await send({ type: "SAVE", requestId: "s", payload: { path: "bands/7/members", status: "new", values: { name: "x" } } });
        await send({ type: "SAVE", requestId: "a", payload: { path: "posts/1/tags", status: "new", values: { name: "new" } } });
        await send({ type: "DELETE", requestId: "c", payload: { row: { path: "posts/1/tags", id: 5 } } });
        expect(writes).toHaveLength(3);
    });

    it("leaves an update through an owning parent alone: it moves nothing", async () => {
        const { send } = await connect(["viewer"]);
        await send({ type: "SAVE", requestId: "u", payload: { path: "bands/7/members", id: 3, status: "existing", values: { name: "renamed" } } });
        expect(writes).toHaveLength(1);
    });
});
