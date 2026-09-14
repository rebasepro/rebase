/**
 * E2E: the Mongo realtime socket refuses a path the registry does not resolve.
 *
 * MongoDB has no row-level security, so on this engine the registry is the whole
 * of the access model: a `securityRule` is enforced only for a collection the
 * registry knows, and `MongoDataService.getCollection` maps *any* path to a
 * physical collection by replacing `/` with `_`. Nothing between the socket and
 * the database asked whether the path named a registered data collection.
 *
 * So an authenticated non-admin — or, when `requireAuth` is false, an anonymous
 * client — could name the auth store as the path. `AuthenticatedMongoDriver`
 * resolved the collection to `undefined` (registry miss, no server-supplied
 * config), and every rule check has an `if (!collection)` short-circuit that
 * answers "allowed": `authorize(undefined)` returns `true`, and
 * `buildMongoFilterFromSecurityRules(undefined)` returns "match all". The result
 * was a full read/write channel onto `rebase_users` (password hashes),
 * `rebase_user_roles` (grant yourself admin), `rebase_refresh_tokens`, and every
 * other collection the platform keeps beside the data ones.
 *
 * Nothing here is faked: a real MongoDB (memory server), the real socket handler
 * on a real HTTP server, a raw `ws` client sending the frames an attacker would
 * send, and the auth rows seeded through `MongoUserService` — the same writer the
 * platform uses.
 *
 * The gate is the registry check at the socket boundary. The four mutations that
 * must each turn a case red: drop the check on FETCH_COLLECTION, on FETCH_ONE, on
 * a write (SAVE/DELETE), and on the subscribe frames.
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { createServer, type Server } from "http";
import { AddressInfo } from "net";
import { WebSocket as NodeWebSocket } from "ws";
import type { AuthAdapter, CollectionConfig } from "@rebasepro/types";
import { MongoDriver } from "../src/services/MongoDriver";
import { MongoRealtimeService } from "../src/services/MongoRealtimeService";
import { MongoCollectionRegistry } from "../src/factory";
import { MongoUserService } from "../src/auth/services";
import { createMongoWebSocket } from "../src/websocket";

/** The one data collection this backend actually serves. */
const notes: CollectionConfig = {
    slug: "notes",
    name: "Notes (MongoDB)",
    engine: "mongodb",
    properties: {
        title: { name: "Title", type: "string" },
        owner_id: { name: "Owner", type: "string" }
    },
    securityRules: [{ name: "own_notes", operations: ["all"], ownerField: "owner_id" }]
};

/** A normal signed-in user. Not an admin — this is the everyday caller. */
const MALLORY = { uid: "mallory", email: "mallory@example.com", roles: ["editor"], isAdmin: false };

/** An adapter that trusts exactly one token, and mints a non-admin session. */
const adapter: AuthAdapter = {
    verifyRequest: async () => null,
    verifyToken: async (token: string) => (token === "mallory-token" ? MALLORY : null)
} as unknown as AuthAdapter;

describe("Mongo socket refuses an unregistered path (E2E)", () => {
    let mongoServer: MongoMemoryServer;
    let client: MongoClient;
    let db: Db;
    let realtimeService: MongoRealtimeService;
    let driver: MongoDriver;
    let server: Server;
    let url: string;
    let refreshTokenId: string;

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        client = new MongoClient(mongoServer.getUri());
        await client.connect();
        db = client.db("test_unregistered_path");

        // Seed the auth store the way the platform does.
        const users = new MongoUserService(db);
        await users.createUser({
            email: "victim@example.com",
            passwordHash: "$2b$10$THISisTheVICTIMpasswordHASHneverLeaks",
            displayName: "Victim"
        } as never);

        // A real ObjectId `_id`, so the driver's `toObjectId` addresses it and a
        // DELETE genuinely reaches the document — otherwise the frame 404s on an
        // id-type mismatch and the probe passes for the wrong reason.
        const refreshOid = new ObjectId();
        refreshTokenId = refreshOid.toString();
        await db.collection("rebase_refresh_tokens").insertOne({
            _id: refreshOid, uid: "victim", tokenHash: "secret-hash", createdAt: new Date()
        } as never);

        // A notes row owned by someone other than Mallory, so the registered
        // path's own row security is observably still working.
        await db.collection("notes").insertOne({
            _id: new ObjectId(), title: "Not Mallory's", owner_id: "someone-else"
        } as never);

        const registry = new MongoCollectionRegistry();
        registry.register(notes);
        realtimeService = new MongoRealtimeService(db);
        driver = new MongoDriver(db, realtimeService, undefined, registry);

        server = createServer();
        createMongoWebSocket(server, realtimeService, driver, undefined, undefined, adapter);
        await new Promise<void>((resolve) => server.listen(0, resolve));
        url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        await realtimeService.closeAll().catch(() => {});
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await client.close();
        await mongoServer.stop();
    });

    /**
     * One authenticated socket, and an `rpc` that resolves with the frame whose
     * `requestId` matches — or, for subscribe frames, the first frame carrying
     * the subscription id.
     */
    const connectAsMallory = async () => {
        const ws = new NodeWebSocket(url);
        await new Promise<void>((resolve, reject) => {
            ws.once("open", () => resolve());
            ws.once("error", reject);
        });

        const waiters = new Map<string, (frame: any) => void>();
        ws.on("message", (data) => {
            const frame = JSON.parse(data.toString());
            const key = frame.requestId ?? frame.subscriptionId;
            const w = key && waiters.get(key);
            if (w) { waiters.delete(key); w(frame); }
        });

        const rpc = (type: string, payload: unknown, key: string): Promise<any> =>
            new Promise((resolve) => {
                waiters.set(key, resolve);
                ws.send(JSON.stringify({ type, requestId: key, payload }));
            });

        const authFrame = await rpc("AUTHENTICATE", { token: "mallory-token" }, "auth-1");
        expect(authFrame.type).toBe("AUTH_SUCCESS");

        return { ws, rpc };
    };

    const isRefusal = (frame: any): boolean =>
        frame.type === "ERROR" && !!frame.payload?.error?.code
        && frame.payload.error.code !== "INTERNAL_ERROR";

    it("refuses to LIST the auth users collection — no password hashes cross the wire", async () => {
        const { ws, rpc } = await connectAsMallory();
        try {
            const frame = await rpc("FETCH_COLLECTION", { path: "rebase_users" }, "r1");

            expect(frame.type).not.toBe("FETCH_COLLECTION_SUCCESS");
            expect(isRefusal(frame)).toBe(true);
            // Belt and braces: whatever the frame is, it carries no hash.
            expect(JSON.stringify(frame)).not.toContain("passwordHash");
            expect(JSON.stringify(frame)).not.toContain("THISisTheVICTIM");
        } finally {
            ws.close();
        }
    });

    it("refuses to FETCH_ONE from the auth users collection", async () => {
        const victim = await db.collection("rebase_users").findOne({ email: "victim@example.com" });
        const { ws, rpc } = await connectAsMallory();
        try {
            const frame = await rpc("FETCH_ONE", { path: "rebase_users", id: String(victim!._id) }, "r2");

            expect(frame.type).not.toBe("FETCH_ONE_SUCCESS");
            expect(isRefusal(frame)).toBe(true);
            expect(JSON.stringify(frame)).not.toContain("THISisTheVICTIM");
        } finally {
            ws.close();
        }
    });

    it("refuses a SAVE that would grant the caller an admin role, and writes nothing", async () => {
        const before = await db.collection("rebase_user_roles").countDocuments({ uid: "mallory" });
        const { ws, rpc } = await connectAsMallory();
        try {
            const frame = await rpc("SAVE", {
                path: "rebase_user_roles",
                values: { uid: "mallory", roleId: "admin" },
                status: "new"
            }, "r3");

            expect(frame.type).not.toBe("SAVE_SUCCESS");
            expect(isRefusal(frame)).toBe(true);
        } finally {
            ws.close();
        }
        const after = await db.collection("rebase_user_roles").countDocuments({ uid: "mallory" });
        expect(after).toBe(before);
    });

    it("refuses a DELETE of an auth refresh token, and the token survives", async () => {
        const { ws, rpc } = await connectAsMallory();
        try {
            const frame = await rpc("DELETE", {
                row: { id: refreshTokenId, path: "rebase_refresh_tokens" }
            }, "r4");

            expect(frame.type).not.toBe("DELETE_SUCCESS");
            expect(isRefusal(frame)).toBe(true);
        } finally {
            ws.close();
        }
        const stillThere = await db.collection("rebase_refresh_tokens").findOne({ _id: new ObjectId(refreshTokenId) as never });
        expect(stillThere).not.toBeNull();
    });

    it("refuses a subscription to the auth users collection", async () => {
        const { ws, rpc } = await connectAsMallory();
        try {
            const frame = await rpc("subscribe_collection", {
                path: "rebase_users", subscriptionId: "sub-users"
            }, "sub-users");

            // The leak here is a `collection_update` frame carrying the rows.
            expect(frame.type).not.toBe("collection_update");
            expect(frame.type).toBe("ERROR");
            expect(JSON.stringify(frame)).not.toContain("THISisTheVICTIM");
        } finally {
            ws.close();
        }
    });

    it("still serves the registered collection — and its own row security holds", async () => {
        const { ws, rpc } = await connectAsMallory();
        try {
            const frame = await rpc("FETCH_COLLECTION", { path: "notes" }, "ok1");

            expect(frame.type).toBe("FETCH_COLLECTION_SUCCESS");
            // Mallory owns nothing here, so the ownerField rule returns nothing —
            // the registered path is served AND filtered, unchanged by the fix.
            expect(frame.payload.rows).toEqual([]);
        } finally {
            ws.close();
        }
    });
});
