/**
 * E2E: a guest is a guest on every Mongo door.
 *
 * Anonymous sign-in mints a real user with a real uid, so the one thing that
 * tells a guest from an account is `isAnonymous`. `policy.registered()` ("signed
 * in, and not a guest") reads it, in `securityRuleFilter.ts` for a query and in
 * `evaluatePolicy` for a row in hand. A door that builds the caller's identity
 * without it turns every guest into an account, and a `registered()` rule into
 * `authenticated()`.
 *
 * The doors, and what each one used to build:
 *
 * - The socket's request frames: `getScopedDelegate` wrote `isAnonymous: false`,
 *   and the session never read the flag from the token or the adapter.
 * - The socket's subscriptions: an `authContext` of `{ uid, roles }`.
 * - A socket that never authenticated (`requireAuth: false`): the base driver,
 *   which applies no security rules at all. REST scopes the same caller as the
 *   anonymous user.
 * - An in-process listener: `AuthenticatedMongoDriver.authContext()` was
 *   `{ uid, roles }`, and `MongoRealtimeService.scopedDriver` rebuilt the user
 *   from it.
 *
 * REST was not one of them: both of its middlewares pass the flag to
 * `withAuth` (pinned in `packages/server/test/rest-guest-identity.test.ts`), and
 * a scoped driver reads with the user it was given — the control case below.
 *
 * A real mongod (memory server), the real socket handler on a real HTTP server,
 * a raw `ws` client, and real tokens.
 */
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db, ObjectId } from "mongodb";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket as NodeWebSocket } from "ws";
import { policy, type AuthAdapter, type CollectionConfig, type DataDriver, type User } from "@rebasepro/types";
// From the file itself: the public entry point exports `configureJwt` only.
// Same module instance the socket verifies tokens with.
import { configureJwt, generateAccessToken } from "../../server/src/auth/jwt";
import { MongoDriver } from "../src/services/MongoDriver";
import { MongoRealtimeService } from "../src/services/MongoRealtimeService";
import { MongoCollectionRegistry } from "../src/factory";
import { createMongoWebSocket } from "../src/websocket";

/** Members only: readable and writable by an account, and by no guest. */
const briefings: CollectionConfig = {
    slug: "briefings",
    name: "Briefings",
    engine: "mongodb",
    properties: { title: { name: "Title", type: "string" } },
    securityRules: [{ name: "members_only", operations: ["all"], condition: policy.registered() }]
};

const GUEST: User = {
    uid: "guest-7",
    displayName: null,
    email: null,
    photoURL: null,
    providerId: "anonymous",
    isAnonymous: true,
    roles: []
};

const MEMBER: User = { ...GUEST, uid: "member-1", providerId: "password", isAnonymous: false };

/** Trusts two tokens, the way an external identity provider would. */
const adapter = {
    verifyRequest: async () => null,
    verifyToken: async (token: string) => {
        if (token === "guest-token") return { uid: GUEST.uid, email: "", roles: [], isAdmin: false, isAnonymous: true };
        if (token === "member-token") return { uid: MEMBER.uid, email: "", roles: [], isAdmin: false, isAnonymous: false };
        return null;
    }
} as unknown as AuthAdapter;

type Frame = { type: string; requestId?: string; subscriptionId?: string; payload?: any; rows?: unknown[]; row?: unknown };

/** One socket, and frames addressed to it by `requestId` or `subscriptionId`. */
async function open(port: number) {
    const ws = new NodeWebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("error", reject);
    });
    const waiters = new Map<string, (frame: Frame) => void>();
    ws.on("message", (data) => {
        const frame = JSON.parse(String(data)) as Frame;
        const key = frame.requestId ?? frame.subscriptionId;
        const waiter = key && waiters.get(key);
        if (waiter) {
            waiters.delete(key);
            waiter(frame);
        }
    });
    let seq = 0;
    /** Send a frame and resolve with the first one answering it. */
    const send = (type: string, payload: Record<string, unknown>): Promise<Frame> =>
        new Promise((resolve, reject) => {
            const key = `${type}-${++seq}`;
            const timer = setTimeout(() => reject(new Error(`No answer to ${type}`)), 5_000);
            waiters.set(key, (frame) => {
                clearTimeout(timer);
                resolve(frame);
            });
            const subscribing = type.startsWith("subscribe_");
            ws.send(JSON.stringify(subscribing
                ? { type, payload: { ...payload, subscriptionId: key } }
                : { type, requestId: key, payload }));
        });
    return { ws, send };
}

/** The first delivery an in-process listener hears. */
function firstDelivery(listen: (onUpdate: (data: unknown) => void, onError: (error: Error) => void) => () => void) {
    return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("The listener heard nothing")), 5_000);
        const unsubscribe = listen(
            (data) => { clearTimeout(timer); unsubscribe(); resolve(data); },
            (error) => { clearTimeout(timer); unsubscribe(); reject(error); }
        );
    });
}

describe("a guest is a guest on every Mongo door (E2E)", () => {
    let mongo: MongoMemoryServer;
    let client: MongoClient;
    let db: Db;
    let realtime: MongoRealtimeService;
    let driver: MongoDriver;
    let briefingId: string;
    /** Authenticates through the adapter. */
    let adapterServer: Server;
    /** Authenticates by the platform's own JWT, and lets an unauthenticated socket in. */
    let jwtServer: Server;
    const sockets: NodeWebSocket[] = [];

    const portOf = (server: Server) => (server.address() as AddressInfo).port;

    async function signedIn(server: Server, token: string) {
        const socket = await open(portOf(server));
        sockets.push(socket.ws);
        const auth = await socket.send("AUTHENTICATE", { token });
        expect(auth.type).toBe("AUTH_SUCCESS");
        return socket;
    }

    beforeAll(async () => {
        configureJwt({ secret: "guest-identity-e2e-secret-0123456789abcdef", accessExpiresIn: "1h" });

        mongo = await MongoMemoryServer.create();
        client = new MongoClient(mongo.getUri());
        await client.connect();
        db = client.db("test_guest_identity");

        const oid = new ObjectId();
        briefingId = oid.toString();
        await db.collection("briefings").insertOne({ _id: oid, title: "Quarterly plan" } as never);

        const registry = new MongoCollectionRegistry();
        registry.register(briefings);
        realtime = new MongoRealtimeService(db);
        driver = new MongoDriver(db, realtime, undefined, registry);

        adapterServer = createServer();
        createMongoWebSocket(adapterServer, realtime, driver, undefined, undefined, adapter);
        await new Promise<void>((resolve) => adapterServer.listen(0, resolve));

        jwtServer = createServer();
        createMongoWebSocket(jwtServer, realtime, driver, { requireAuth: false });
        await new Promise<void>((resolve) => jwtServer.listen(0, resolve));
    });

    afterAll(async () => {
        for (const ws of sockets) ws.close();
        await realtime?.closeAll().catch(() => {});
        for (const server of [adapterServer, jwtServer]) {
            await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
        }
        await client?.close();
        await mongo?.stop();
    });

    describe("the socket, signed in through an adapter", () => {
        it("lists nothing a registered() rule withholds from a guest", async () => {
            const { send } = await signedIn(adapterServer, "guest-token");

            const frame = await send("FETCH_COLLECTION", { path: "briefings" });

            expect(frame.type).toBe("FETCH_COLLECTION_SUCCESS");
            expect(frame.payload.rows).toEqual([]);
        });

        it("still lists them for an account", async () => {
            const { send } = await signedIn(adapterServer, "member-token");

            const frame = await send("FETCH_COLLECTION", { path: "briefings" });

            expect(frame.payload.rows).toEqual(expect.arrayContaining([expect.objectContaining({ title: "Quarterly plan" })]));
        });

        it("does not hand a guest the row by id", async () => {
            const { send } = await signedIn(adapterServer, "guest-token");

            const frame = await send("FETCH_ONE", { path: "briefings", id: briefingId });

            expect(JSON.stringify(frame)).not.toContain("Quarterly plan");
        });

        it("refuses a guest's write, and writes nothing", async () => {
            const { send } = await signedIn(adapterServer, "guest-token");

            const frame = await send("SAVE", { path: "briefings", values: { title: "Posted by a guest" }, status: "new" });

            expect(frame.type).not.toBe("SAVE_SUCCESS");
            expect(await db.collection("briefings").countDocuments({ title: "Posted by a guest" })).toBe(0);
        });

        it("subscribes a guest as a guest", async () => {
            const { send } = await signedIn(adapterServer, "guest-token");

            const frame = await send("subscribe_collection", { path: "briefings" });

            expect(frame.type).toBe("collection_update");
            expect(frame.rows).toEqual([]);
        });
    });

    describe("the socket, signed in by token", () => {
        it("lists nothing a registered() rule withholds from a guest", async () => {
            const token = await generateAccessToken(GUEST.uid, [], "aal1", undefined, true);
            const { send } = await signedIn(jwtServer, token);

            const frame = await send("FETCH_COLLECTION", { path: "briefings" });

            expect(frame.payload.rows).toEqual([]);
        });

        it("subscribes a guest as a guest", async () => {
            const token = await generateAccessToken(GUEST.uid, [], "aal1", undefined, true);
            const { send } = await signedIn(jwtServer, token);

            const frame = await send("subscribe_collection", { path: "briefings" });

            expect(frame.rows).toEqual([]);
        });

        it("still lists them for an account", async () => {
            const token = await generateAccessToken(MEMBER.uid, []);
            const { send } = await signedIn(jwtServer, token);

            const frame = await send("FETCH_COLLECTION", { path: "briefings" });

            expect(frame.payload.rows).toEqual(expect.arrayContaining([expect.objectContaining({ title: "Quarterly plan" })]));
        });
    });

    describe("a socket that never authenticated", () => {
        it("reads as the anonymous user, as REST does, not as the server", async () => {
            const socket = await open(portOf(jwtServer));
            sockets.push(socket.ws);

            const frame = await socket.send("FETCH_COLLECTION", { path: "briefings" });

            expect(frame.type).toBe("FETCH_COLLECTION_SUCCESS");
            expect(frame.payload.rows).toEqual([]);
        });

        it("cannot write where the rules refuse the anonymous user", async () => {
            const socket = await open(portOf(jwtServer));
            sockets.push(socket.ws);

            const frame = await socket.send("SAVE", { path: "briefings", values: { title: "Posted by nobody" }, status: "new" });

            expect(frame.type).not.toBe("SAVE_SUCCESS");
            expect(await db.collection("briefings").countDocuments({ title: "Posted by nobody" })).toBe(0);
        });
    });

    describe("an in-process listener", () => {
        let guestDriver: DataDriver;

        beforeAll(async () => {
            guestDriver = await driver.withAuth(GUEST);
        });

        it("hands a guest's collection listener nothing a registered() rule withholds", async () => {
            const rows = await firstDelivery((onUpdate, onError) =>
                guestDriver.listenCollection!({ path: "briefings", onUpdate, onError }));

            expect(rows).toEqual([]);
        });

        it("hands a guest's row listener null, not the row", async () => {
            const row = await firstDelivery((onUpdate, onError) =>
                guestDriver.listenOne!({ path: "briefings", id: briefingId, onUpdate, onError }));

            expect(row).toBeNull();
        });

        it("still serves an account's listener", async () => {
            const memberDriver = await driver.withAuth(MEMBER);

            const rows = await firstDelivery((onUpdate, onError) =>
                memberDriver.listenCollection!({ path: "briefings", onUpdate, onError }));

            expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({ title: "Quarterly plan" })]));
        });

    });

    /**
     * What REST calls. Both REST middlewares hand `withAuth` the flag, and a
     * listing reads it through `buildMongoFilterFromSecurityRules`. A single
     * row did not: `fetchOne`, `save` and `delete` decide through
     * `checkOperation`, which built its policy context without `isAnonymous`,
     * so `GET /:id`, `POST`, `PATCH` and `DELETE` let a guest through too.
     */
    describe("the scoped driver REST serves every route with", () => {
        let guestDriver: DataDriver;

        beforeAll(async () => {
            guestDriver = await driver.withAuth(GUEST);
        });

        it("lists nothing for a guest", async () => {
            expect(await guestDriver.fetchCollection({ path: "briefings" })).toEqual([]);
        });

        it("does not hand a guest the row by id", async () => {
            expect(await guestDriver.fetchOne({ path: "briefings", id: briefingId })).toBeUndefined();
        });

        it("refuses a guest's insert, and writes nothing", async () => {
            await expect(guestDriver.save({ path: "briefings", values: { title: "Posted over REST" }, status: "new" }))
                .rejects.toBeDefined();
            expect(await db.collection("briefings").countDocuments({ title: "Posted over REST" })).toBe(0);
        });

        it("refuses a guest's delete, and the row survives", async () => {
            await expect(guestDriver.delete({ row: { id: briefingId, path: "briefings" } })).rejects.toBeDefined();
            expect(await db.collection("briefings").countDocuments({ _id: new ObjectId(briefingId) } as never)).toBe(1);
        });

        it("still serves an account", async () => {
            const memberDriver = await driver.withAuth(MEMBER);
            expect(await memberDriver.fetchOne({ path: "briefings", id: briefingId })).toEqual(
                expect.objectContaining({ title: "Quarterly plan" })
            );
        });
    });
});
