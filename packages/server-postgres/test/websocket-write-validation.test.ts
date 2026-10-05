import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { Server } from "http";

let mockWssInstance: any = null;

jest.mock("ws", () => ({
    WebSocketServer: jest.fn().mockImplementation(() => {
        const instance = { on: jest.fn(), clients: new Set() };
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
    assertNoFieldOpsOnCreate: require("../../server/src/api/rest/field-ops").assertNoFieldOpsOnCreate,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    splitFieldOps: require("../../server/src/api/rest/field-ops").splitFieldOps,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    declaredErrorAnswer: require("../../server/src/api/errors").declaredErrorAnswer,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ApiError: require("../../server/src/api/errors").ApiError,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    resolveConflictTarget: require("../../server/src/api/rest/conflict-target").resolveConflictTarget,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    assertNestedWriteAllowed: require("../../server/src/api/rest/nested-write-access").assertNestedWriteAllowed,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    assertUserCreationBodyValid: require("../../server/src/api/rest/auth-collection-writes").assertUserCreationBodyValid,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    createUserThroughAuthCollection: require("../../server/src/api/rest/auth-collection-writes").createUserThroughAuthCollection
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

/**
 * The auth collection's rows are the users, and the socket is a door into them
 * too. It asks the auth adapter what `/admin/users` and the data API's REST
 * routes ask: the last administrator stays one, `beforeUserDelete` may veto,
 * and an email is stored the way sign-in looks it up.
 */
describe("a socket write to the auth collection", () => {
    const users = {
        slug: "users", name: "Users", table: "users", auth: { enabled: true },
        properties: {
            id: { name: "ID", type: "string", isId: "uuid" },
            email: { name: "Email", type: "string" },
            roles: { name: "Roles", type: "array", of: { name: "Role", type: "string" } }
        }
    };

    let writes: unknown[];
    let failWrites: boolean;
    let userAdmin: {
        prepareUserUpdates: jest.Mock;
        prepareUserDeletions: jest.Mock;
        finalizeUserDeletions: jest.Mock;
        prepareUserCreation: jest.Mock;
        describeUserCreationContract: jest.Mock;
        finalizeUserCreation: jest.Mock;
    };

    const connect = async () => {
        const handlers: Record<string, (...args: any[]) => any> = {};
        const ws = {
            send: jest.fn(),
            on: (event: string, cb: (...args: any[]) => any) => { handlers[event] = cb; },
            readyState: 1,
            close: jest.fn()
        };
        mockWssInstance.on.mock.calls.find((c: any[]) => c[0] === "connection")[1](ws, { url: "/", headers: {} });
        const send = (msg: unknown) => handlers.message(JSON.stringify(msg));
        await send({ type: "AUTHENTICATE", requestId: "auth", payload: { token: "admin" } });
        const last = () => JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0]);
        return { send, last };
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockWssInstance = null;
        writes = [];
        failWrites = false;
        userAdmin = {
            // The built-in adapter's shape: `password` is consumed, hashed,
            // and a generated one is delivered when none was given.
            prepareUserCreation: jest.fn(async (body: Record<string, unknown>) => {
                const { password, ...rest } = body;
                return {
                    values: { ...rest, email: String(body.email).trim().toLowerCase(), passwordHash: `hashed:${password ?? "generated"}` },
                    clearPassword: password ? undefined : "generated",
                    hookHandledEmail: false,
                    invitationSent: false
                };
            }),
            describeUserCreationContract: jest.fn(() => ({ validate: true, extraFields: ["password"] })),
            finalizeUserCreation: jest.fn(async (_row: unknown, clearPassword?: string) =>
                clearPassword ? { temporaryPassword: clearPassword, invitationSent: false } : { invitationSent: false }),
            prepareUserUpdates: jest.fn(async (updates: { values: Record<string, unknown> }[]) =>
                updates.map(({ values }) => typeof values.email === "string" ? { ...values, email: values.email.toLowerCase() } : values)),
            prepareUserDeletions: jest.fn(async (uids: string[]) => {
                if (uids.includes("admin-1")) {
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    const { ApiError } = require("../../server/src/api/errors");
                    throw ApiError.forbidden("Cannot delete the last administrator", "LAST_ADMIN");
                }
            }),
            finalizeUserDeletions: jest.fn(async () => undefined)
        };
        const adapter = {
            verifyToken: async () => ({ uid: "admin-1", roles: ["admin"], isAdmin: true }),
            ...userAdmin
        } as unknown as AuthAdapter;
        const driver = {
            key: "postgres",
            initialised: true,
            registry: { getCollectionByPath: (path: string) => (path === "users" ? users : undefined) },
            save: async (props: { values: Record<string, unknown> }) => {
                if (failWrites) throw new Error("the write failed");
                writes.push(props);
                return { id: "u-new", ...props.values };
            },
            delete: async (props: unknown) => { writes.push(props); },
            withAuth: undefined
        } as unknown as PostgresBackendDriver;
        createPostgresWebSocket({} as Server, { addClient: jest.fn(), rescopeClient: jest.fn() } as unknown as RealtimeService, driver, undefined, adapter);
    });

    it("stores an update in the form the auth adapter puts it in", async () => {
        const { send } = await connect();

        await send({ type: "SAVE", requestId: "s", payload: { path: "users", id: "u-2", status: "existing", values: { email: "Ann@Example.COM" } } });

        expect(userAdmin.prepareUserUpdates).toHaveBeenCalledWith([{ uid: "u-2", values: { email: "Ann@Example.COM" } }]);
        expect(writes).toEqual([expect.objectContaining({ values: { email: "ann@example.com" } })]);
    });

    it("refuses a delete the auth adapter refuses, and deletes nothing", async () => {
        const { send, last } = await connect();

        await send({ type: "DELETE", requestId: "d", payload: { row: { path: "users", id: "admin-1" } } });

        expect(last()).toMatchObject({ type: "ERROR", payload: { error: { code: "LAST_ADMIN" } } });
        expect(writes).toEqual([]);
        expect(userAdmin.finalizeUserDeletions).not.toHaveBeenCalled();
    });

    it("finalizes a delete it allowed, after the row is gone", async () => {
        const { send } = await connect();

        await send({ type: "DELETE", requestId: "d", payload: { row: { path: "users", id: "u-2" } } });

        expect(userAdmin.prepareUserDeletions).toHaveBeenCalledWith(["u-2"]);
        expect(writes).toHaveLength(1);
        expect(userAdmin.finalizeUserDeletions).toHaveBeenCalledWith(["u-2"]);
    });

    /**
     * A create on the auth collection is a user creation, as on `POST /users`.
     * The socket wrote it as any table's row: `password` was refused as an
     * unknown field, so the user had none and was never invited, the email
     * was stored as typed (sign-in looks it up normalized), and the
     * collection's `onCreateUser` never ran.
     */
    it("creates a user through the auth adapter, and hands back what POST /users does", async () => {
        const { send, last } = await connect();

        await send({ type: "SAVE", requestId: "c", payload: { path: "users", status: "new", values: { email: " Ann@Example.COM " } } });

        expect(userAdmin.prepareUserCreation).toHaveBeenCalledWith({ email: " Ann@Example.COM " }, { enabled: true });
        expect(writes).toEqual([expect.objectContaining({
            path: "users", status: "new", values: { email: "ann@example.com", passwordHash: "hashed:generated" }
        })]);
        expect(userAdmin.finalizeUserCreation).toHaveBeenCalledWith(
            { id: "u-new", values: expect.objectContaining({ email: "ann@example.com" }) }, "generated"
        );
        expect(last()).toMatchObject({
            type: "SAVE_SUCCESS",
            payload: { row: { id: "u-new", email: "ann@example.com", temporaryPassword: "generated", invitationSent: false } }
        });
    });

    it("accepts the password a user creation consumes, and still refuses a field the collection does not have", async () => {
        const { send, last } = await connect();

        await send({ type: "SAVE", requestId: "c", payload: { path: "users", status: "new", values: { email: "a@b.c", password: "pw-123456" } } });
        expect(writes).toEqual([expect.objectContaining({ values: { email: "a@b.c", passwordHash: "hashed:pw-123456" } })]);

        await send({ type: "SAVE", requestId: "d", payload: { path: "users", status: "new", values: { email: "d@e.f", nmae: "x" } } });
        expect(last()).toMatchObject({ type: "ERROR" });
        expect(writes).toHaveLength(1);
    });

    it("delivers no credentials when the write fails", async () => {
        const { send, last } = await connect();
        failWrites = true;

        await send({ type: "SAVE", requestId: "c", payload: { path: "users", status: "new", values: { email: "a@b.c" } } });

        expect(last()).toMatchObject({ type: "ERROR" });
        expect(userAdmin.finalizeUserCreation).not.toHaveBeenCalled();
    });
});
