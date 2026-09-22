/**
 * E2E: the Mongo socket applies per-field `access` — both halves.
 *
 * `SAVE` ran the REST write checks with no viewer, which is the trusted server
 * plane: every non-empty `access.write` list is satisfied by it, so a caller
 * with none of the named roles wrote the field anyway. It also skipped the
 * field-operation type check the Postgres socket runs. And rows went out whole:
 * a field a caller may not read rode out on every `FETCH_COLLECTION` and every
 * `collection_update`.
 *
 * A real MongoDB (memory server), the real socket handler on a real HTTP
 * server, and a raw `ws` client sending the frames a caller would.
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
import { createMongoWebSocket } from "../src/websocket";

const staff: CollectionConfig = {
    slug: "staff",
    name: "Staff",
    engine: "mongodb",
    properties: {
        name: { name: "Name", type: "string" },
        views: { name: "Views", type: "number" },
        salary: { name: "Salary", type: "number", access: { read: ["hr"], write: ["hr"] } },
        apiToken: { name: "API token", type: "string", excludeFromApi: true }
    }
};

/** Signed in, but not in `hr`. */
const EDITOR = { uid: "eddie", email: "eddie@example.com", roles: ["editor"], isAdmin: false };

const adapter: AuthAdapter = {
    verifyRequest: async () => null,
    verifyToken: async (token: string) => (token === "editor-token" ? EDITOR : null)
} as unknown as AuthAdapter;

describe("Mongo socket per-field access (E2E)", () => {
    let mongoServer: MongoMemoryServer;
    let client: MongoClient;
    let db: Db;
    let realtimeService: MongoRealtimeService;
    let server: Server;
    let url: string;
    let rowId: string;

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        client = new MongoClient(mongoServer.getUri());
        await client.connect();
        db = client.db("test_ws_field_access");

        const inserted = await db.collection("staff").insertOne({
            _id: new ObjectId(), name: "Dana", views: 3, salary: 120000, apiToken: "tok_live_secret"
        });
        rowId = inserted.insertedId.toString();

        const registry = new MongoCollectionRegistry();
        registry.register(staff);
        realtimeService = new MongoRealtimeService(db);
        const driver = new MongoDriver(db, realtimeService, undefined, registry);

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

    const connectAsEditor = async () => {
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

        const authFrame = await rpc("AUTHENTICATE", { token: "editor-token" }, "auth-1");
        expect(authFrame.type).toBe("AUTH_SUCCESS");
        return { ws, rpc };
    };

    it("refuses a SAVE of a field the caller's roles may not write, and writes nothing", async () => {
        const { ws, rpc } = await connectAsEditor();
        try {
            const frame = await rpc("SAVE", {
                path: "staff", id: rowId, values: { salary: 1 }, status: "existing"
            }, "w1");
            expect(frame.type).toBe("ERROR");
            expect(frame.payload.error.code).toBe("FIELD_NOT_WRITABLE");
        } finally {
            ws.close();
        }
        const stored = await db.collection("staff").findOne({ _id: new ObjectId(rowId) });
        expect(stored?.salary).toBe(120000);
    });

    it("refuses a field operation the property's type cannot take", async () => {
        const { ws, rpc } = await connectAsEditor();
        try {
            const frame = await rpc("SAVE", {
                path: "staff", id: rowId, values: { views: { $push: 1 } }, status: "existing"
            }, "w2");
            expect(frame.type).toBe("ERROR");
            expect(frame.payload.error.code).toBe("INVALID_FIELD_OPERATION");
        } finally {
            ws.close();
        }
        const stored = await db.collection("staff").findOne({ _id: new ObjectId(rowId) });
        expect(stored?.views).toBe(3);
    });

    it("serves rows without the fields the caller may not read", async () => {
        const { ws, rpc } = await connectAsEditor();
        try {
            const frame = await rpc("FETCH_COLLECTION", { path: "staff" }, "r1");
            expect(frame.type).toBe("FETCH_COLLECTION_SUCCESS");
            expect(frame.payload.rows).toEqual([{ id: rowId, name: "Dana", views: 3 }]);

            const one = await rpc("FETCH_ONE", { path: "staff", id: rowId }, "r2");
            expect(one.payload.row).toEqual({ id: rowId, name: "Dana", views: 3 });
        } finally {
            ws.close();
        }
    });

    it("pushes subscription rows without them too", async () => {
        const { ws, rpc } = await connectAsEditor();
        try {
            const frame = await rpc("subscribe_collection", { path: "staff", subscriptionId: "sub-1" }, "sub-1");
            expect(frame.type).toBe("collection_update");
            expect(frame.rows).toEqual([{ id: rowId, name: "Dana", views: 3 }]);
        } finally {
            ws.close();
        }
    });
});
