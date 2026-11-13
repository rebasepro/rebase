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
    isDatabaseUnreachable: require("../../server/src/api/errors").isDatabaseUnreachable,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    DATABASE_UNAVAILABLE_MESSAGE: require("../../server/src/api/errors").DATABASE_UNAVAILABLE_MESSAGE,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    resolveConflictTarget: require("../../server/src/api/rest/conflict-target").resolveConflictTarget,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    assertNestedWriteAllowed: require("../../server/src/api/rest/nested-write-access").assertNestedWriteAllowed,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    assertUserCreationBodyValid: require("../../server/src/api/rest/auth-table-writes").assertUserCreationBodyValid,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    assertNoUserUpsert: require("../../server/src/api/rest/auth-table-writes").assertNoUserUpsert,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    createUserThroughAuthTable: require("../../server/src/api/rest/auth-table-writes").createUserThroughAuthTable,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    isAuthTable: require("../../server/src/api/rest/auth-table-writes").isAuthTable
}));

import type { AuthAdapter, SaveProps } from "@rebasepro/types";
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";
import { createPostgresWebSocket, type SocketDataDriver } from "../src/websocket";
import { fakeAuthAdapter, fakeDataDriver, fakeSocketRealtime } from "./helpers/spg-c-socket";
import { registryOf } from "./helpers/spg-c-registry";
import { col, defineTable, rel } from "@rebasepro/types";
import { compileSchema, lowerTables } from "@rebasepro/common";
import { buildTableRegistry } from "../src/model/build-registry";

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
    let saved: unknown[];

    /** The collection the *registry* answers with — the authoritative one. */
    const usersCollection: LegacyCollectionConfig = {
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
    const profilesCollection: LegacyCollectionConfig = {
        slug: "profiles",
        name: "Profiles",
        table: "profiles",
        properties: {
            id: { name: "ID", type: "string", isId: true },
            handle: { name: "Handle", type: "string", validation: { required: true } },
            bio: { name: "Bio", type: "string" }
        }
    };

    /** Docs, and the owners they are written through: `owners/1/docs`. */
    const docsCollection: LegacyCollectionConfig = {
        slug: "docs",
        name: "Docs",
        table: "docs",
        properties: { id: { name: "ID", type: "number", isId: true }, title: { name: "Title", type: "string" } }
    };
    const ownersCollection: LegacyCollectionConfig = {
        slug: "owners",
        name: "Owners",
        table: "owners",
        properties: {
            id: { name: "ID", type: "number", isId: true },
            docs: { name: "Docs", type: "relation", relation: { kind: "hasMany", target: () => docsCollection, foreignKeyOnTarget: "owner_id" } }
        }
    };

    const connect = () => {
        const handlers: Record<string, (...args: any[]) => any> = {};
        const ws = {
            send: jest.fn<(data: string) => void>(),
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

        const mockDriver: SocketDataDriver = {
            ...fakeDataDriver(),
            registry: registryOf(usersCollection, profilesCollection, ownersCollection, docsCollection),
            save: async (props) => { saved.push(props); return {}; }
        };

        createPostgresWebSocket(mockServer = {} as Server, fakeSocketRealtime(), mockDriver, {
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

    it("answers a path the registry does not know with REST's 404, not a validation error", async () => {
        const { send, ws } = connect();

        await send({ type: "SAVE", requestId: "r-2", payload: { path: "unknown", values: { x: 1 } } });

        expect(saved).toHaveLength(0);
        expect(lastFrame(ws)).toMatchObject({ type: "ERROR", requestId: "r-2", payload: { error: { code: "NOT_FOUND" } } });
    });
});

/**
 * A write through a parent writes the parent's relation, and for a child that
 * carries the parent's key, that key — which is not in the body the checks
 * above read. The REST nested routes ask `assertNestedWriteAllowed`; so does
 * this door.
 */
describe("a socket write through a parent's relation", () => {
    const members: LegacyCollectionConfig = {
        slug: "members", name: "Members", table: "members",
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            name: { name: "Name", type: "string" },
            band: { name: "Band", type: "relation", access: { write: ["hr"] }, relation: { kind: "belongsTo", target: () => bands, localKey: "band_id" } }
        }
    };
    const bands: LegacyCollectionConfig = {
        slug: "bands", name: "Bands", table: "bands",
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            name: { name: "Name", type: "string" },
            members: { name: "Members", type: "relation", relation: { kind: "hasMany", target: () => members, foreignKeyOnTarget: "band_id" } }
        }
    };
    const tags: LegacyCollectionConfig = {
        slug: "tags", name: "Tags", table: "tags",
        properties: { id: { name: "ID", type: "number", isId: "increment" }, name: { name: "Name", type: "string" } }
    };
    const posts: LegacyCollectionConfig = {
        slug: "posts", name: "Posts", table: "posts",
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            tags: {
                name: "Tags", type: "relation", access: { write: ["editor"] },
                relation: { kind: "manyToMany", target: () => tags, through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" } }
            }
        }
    };

    let writes: unknown[];
    let registry: ReturnType<typeof registryOf>;

    const adapter = fakeAuthAdapter({
        verifyToken: async (token: string) => ({ uid: `u-${token}`, email: "", roles: token.split(","), isAdmin: false })
    });

    const connect = async (roles: string[]) => {
        const handlers: Record<string, (...args: any[]) => any> = {};
        const ws = {
            send: jest.fn<(data: string) => void>(),
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
        registry = registryOf(bands, members, posts, tags);
        const driver: SocketDataDriver = {
            ...fakeDataDriver(),
            registry,
            save: async (props) => { writes.push(props); return {}; },
            delete: async (props) => { writes.push(props); }
        };
        createPostgresWebSocket({} as Server, fakeSocketRealtime(), driver, undefined, adapter);
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

    // Fail closed: a nested path the check cannot judge is refused at the
    // socket, never handed to the driver unjudged.
    it("refuses a write through a relation the parent does not have", async () => {
        const { send, last } = await connect(["hr", "editor"]);
        await send({ type: "SAVE", requestId: "x", payload: { path: "bands/7/nothing", status: "new", values: { name: "x" } } });
        expect(last().type).toBe("ERROR");
        expect(writes).toEqual([]);
    });

    it("refuses a write through a hop whose target table is not served", async () => {
        const getTable = registry.getTable.bind(registry);
        jest.spyOn(registry, "getTable").mockImplementation(slug => slug === "members" ? undefined : getTable(slug));
        const { send, last } = await connect(["hr", "editor"]);
        await send({ type: "SAVE", requestId: "y", payload: { path: "bands/7/members", status: "new", values: { name: "x" } } });
        expect(last()).toMatchObject({ type: "ERROR", payload: { error: { code: "FIELD_NOT_WRITABLE" } } });
        expect(writes).toEqual([]);
    });
});

/**
 * The same door over tables authored with `defineTable`: the relation's own
 * `access.write` decides a write through it, and a hop the check cannot
 * resolve is refused rather than handed to the driver unjudged.
 */
describe("a socket write through a parent's relation, declared with defineTable", () => {
    const bandsT = defineTable("bands", {
        columns: { id: col.serial().primaryKey(), name: col.text() },
        relations: { members: rel.hasMany(() => membersT, { foreignKey: "band_id" }) },
        rls: "admin-only"
    });
    const membersT = defineTable("members", {
        columns: { id: col.serial().primaryKey(), name: col.text(), bandId: col.integer("band_id") },
        relations: { band: rel.belongsTo(() => bandsT, { localKey: "band_id", access: { write: ["hr"] } }) },
        rls: "admin-only"
    });

    let writes: unknown[];
    let tables: ReturnType<typeof buildTableRegistry>;
    const adapter = fakeAuthAdapter({
        verifyToken: async (token: string) => ({ uid: `u-${token}`, email: "", roles: token.split(","), isAdmin: false })
    });

    const connect = async (roles: string[]) => {
        type Handler = (data: string) => unknown;
        const handlers: Record<string, Handler> = {};
        const ws = {
            send: jest.fn<(data: string) => void>(),
            on: (event: string, cb: Handler) => { handlers[event] = cb; },
            readyState: 1,
            close: jest.fn()
        };
        mockWssInstance.on.mock.calls.find((c: unknown[]) => c[0] === "connection")[1](ws, { url: "/", headers: {} });
        const send = (msg: unknown) => handlers.message(JSON.stringify(msg));
        await send({ type: "AUTHENTICATE", requestId: "auth", payload: { token: roles.join(",") } });
        const last = () => JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0]);
        return { send, last };
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockWssInstance = null;
        writes = [];
        tables = buildTableRegistry({ compiledTables: compileSchema([bandsT, membersT]), collections: lowerTables([bandsT, membersT]), tables: {} });
        const driver: SocketDataDriver = {
            ...fakeDataDriver(),
            registry: tables,
            save: async (props) => { writes.push(props); return {}; }
        };
        createPostgresWebSocket({} as Server, fakeSocketRealtime(), driver, undefined, adapter);
    });

    it("refuses a create that sets the parent's key a caller may not write, and lets one holding the role", async () => {
        const viewer = await connect(["viewer"]);
        await viewer.send({ type: "SAVE", requestId: "s", payload: { path: "bands/7/members", status: "new", values: { name: "x" } } });
        expect(viewer.last()).toMatchObject({ type: "ERROR", payload: { error: { code: "FIELD_NOT_WRITABLE" } } });
        expect(writes).toEqual([]);
        const hr = await connect(["hr"]);
        await hr.send({ type: "SAVE", requestId: "t", payload: { path: "bands/7/members", status: "new", values: { name: "x" } } });
        expect(writes).toHaveLength(1);
    });

    it("refuses a write through a hop whose target table is not served", async () => {
        const getTable = tables.getTable.bind(tables);
        jest.spyOn(tables, "getTable").mockImplementation(slug => slug === "members" ? undefined : getTable(slug));
        const { send, last } = await connect(["hr"]);
        await send({ type: "SAVE", requestId: "y", payload: { path: "bands/7/members", status: "new", values: { name: "x" } } });
        expect(last()).toMatchObject({ type: "ERROR", payload: { error: { code: "FIELD_NOT_WRITABLE" } } });
        expect(writes).toEqual([]);
    });
});

/**
 * The auth collection's rows are the users, and the socket is a door into them
 * too. It asks the auth adapter what `/admin/users` and the data API's REST
 * routes ask: the last administrator stays one, `beforeUserDelete` may veto,
 * and an email is stored the way sign-in looks it up.
 */
describe("a socket write to the auth collection", () => {
    const users: LegacyCollectionConfig = {
        slug: "users", name: "Users", table: "users", auth: { enabled: true },
        properties: {
            id: { name: "ID", type: "string", isId: "uuid" },
            email: { name: "Email", type: "string" },
            roles: { name: "Roles", type: "array", of: { name: "Role", type: "string" } }
        }
    };

    let writes: unknown[];
    let failWrites: boolean;
    type UserAdminMethod = "prepareUserUpdates" | "prepareUserDeletions" | "finalizeUserDeletions"
        | "prepareUserCreation" | "describeUserCreationContract" | "finalizeUserCreation";
    let userAdmin: { [K in UserAdminMethod]: jest.Mock<NonNullable<AuthAdapter[K]>> };

    const connect = async () => {
        const handlers: Record<string, (...args: any[]) => any> = {};
        const ws = {
            send: jest.fn<(data: string) => void>(),
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
            prepareUserCreation: jest.fn<NonNullable<AuthAdapter["prepareUserCreation"]>>(async (body) => {
                const { password, ...rest } = body;
                return {
                    values: { ...rest, email: String(body.email).trim().toLowerCase(), passwordHash: `hashed:${password ?? "generated"}` },
                    clearPassword: password ? undefined : "generated",
                    hookHandledEmail: false,
                    invitationSent: false
                };
            }),
            describeUserCreationContract: jest.fn<NonNullable<AuthAdapter["describeUserCreationContract"]>>(() => ({ validate: true, extraFields: ["password"] })),
            finalizeUserCreation: jest.fn<NonNullable<AuthAdapter["finalizeUserCreation"]>>(async (_row, clearPassword) =>
                clearPassword ? { temporaryPassword: clearPassword, invitationSent: false } : { invitationSent: false }),
            prepareUserUpdates: jest.fn<NonNullable<AuthAdapter["prepareUserUpdates"]>>(async (updates) =>
                updates.map(({ values }) => typeof values.email === "string" ? { ...values, email: values.email.toLowerCase() } : values)),
            prepareUserDeletions: jest.fn<NonNullable<AuthAdapter["prepareUserDeletions"]>>(async (uids) => {
                if (uids.includes("admin-1")) {
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    const { ApiError } = require("../../server/src/api/errors");
                    throw ApiError.forbidden("Cannot delete the last administrator", "LAST_ADMIN");
                }
            }),
            finalizeUserDeletions: jest.fn<NonNullable<AuthAdapter["finalizeUserDeletions"]>>(async () => undefined)
        };
        const adapter = fakeAuthAdapter({
            verifyToken: async () => ({ uid: "admin-1", email: "", roles: ["admin"], isAdmin: true }),
            ...userAdmin
        });
        const driver: SocketDataDriver = {
            ...fakeDataDriver(),
            registry: registryOf(users),
            save: async (props: SaveProps) => {
                if (failWrites) throw new Error("the write failed");
                writes.push(props);
                return { id: "u-new", ...props.values };
            },
            delete: async (props) => { writes.push(props); }
        };
        createPostgresWebSocket({} as Server, fakeSocketRealtime(), driver, undefined, adapter);
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
     * The socket wrote it like any other table's row: `password` was refused as an
     * unknown field, so the user had none and was never invited, the email
     * was stored as typed (sign-in looks it up normalized), and the
     * collection's `onCreateUser` never ran.
     */
    it("creates a user through the auth adapter, and hands back what POST /users does", async () => {
        const { send, last } = await connect();

        await send({ type: "SAVE", requestId: "c", payload: { path: "users", status: "new", values: { email: " Ann@Example.COM " } } });

        // The session is an administrator's, so the socket lets it waive the
        // password policy, as REST does.
        expect(userAdmin.prepareUserCreation).toHaveBeenCalledWith({ email: " Ann@Example.COM " }, { enabled: true }, { mayWaivePasswordPolicy: true });
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

    it("refuses an upsert on the auth collection: it may be a create or an update, and each has its own rules", async () => {
        const { send, last } = await connect();

        await send({
            type: "SAVE", requestId: "u",
            payload: { path: "users", id: "admin-1", status: "new", upsert: true, values: { email: "a@b.c", roles: ["viewer"] } }
        });

        expect(last()).toMatchObject({ type: "ERROR", payload: { error: { code: "INVALID_CONFLICT_TARGET" } } });
        expect(writes).toEqual([]);
        expect(userAdmin.prepareUserCreation).not.toHaveBeenCalled();
    });
});
