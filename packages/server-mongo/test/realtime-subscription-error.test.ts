/**
 * A Mongo subscription whose fetch fails tells its subscriber.
 *
 * Both fetch paths, the initial one and every re-fetch, caught the error,
 * logged it and sent nothing. The client had neither rows nor an error for the
 * subscription id, so the admin panel stayed on its loading state and the SDK
 * listener's `onError` never fired. The Postgres service sends an error frame
 * from the same catch.
 *
 * What the frame says follows REST. A deliberate 4xx, here the
 * `RebaseApiError` an `afterRead` throws, arrives with its message and code.
 * Anything else is masked. `NODE_ENV=production` for the whole file, because
 * that is where a leaked message matters. A real mongod, the real driver
 * running the real callbacks, the real socket handler on a real HTTP server,
 * and a raw `ws` client.
 */
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { createServer, type Server } from "node:http";
import { WebSocket as NodeWebSocket } from "ws";
import { RebaseApiError, type CollectionConfig } from "@rebasepro/types";
import { MongoDriver } from "../src/services/MongoDriver";
import { MongoRealtimeService } from "../src/services/MongoRealtimeService";
import { MongoCollectionRegistry } from "../src/factory";
import { createMongoWebSocket } from "../src/websocket";

/** Refuses every read, as a callback that gates a whole collection would. */
const dossiers: CollectionConfig = {
    slug: "dossiers",
    name: "Dossiers",
    engine: "mongodb",
    properties: { title: { name: "Title", type: "string" } },
    callbacks: {
        afterRead: () => {
            throw new RebaseApiError("Dossiers are open to case officers only.", { status: 403, code: "FORBIDDEN" });
        }
    }
};

/** Fails the way a fault does: with a message nobody outside should read. */
const ledgers: CollectionConfig = {
    slug: "ledgers",
    name: "Ledgers",
    engine: "mongodb",
    properties: { title: { name: "Title", type: "string" } },
    callbacks: {
        afterRead: () => {
            throw new Error("pool for mongodb://ops:hunter2@10.0.0.7:27017 exhausted");
        }
    }
};

/**
 * A declared 5xx is about the server, not the caller, so it is masked too.
 * REST would pass this message on; the Postgres subscription path does not.
 */
const invoices: CollectionConfig = {
    slug: "invoices",
    name: "Invoices",
    engine: "mongodb",
    properties: { title: { name: "Title", type: "string" } },
    callbacks: {
        afterRead: () => {
            throw new RebaseApiError("billing-internal.svc:8443 returned 503", { status: 503, code: "UNAVAILABLE" });
        }
    }
};

/** Readable until sealed, so the initial fetch succeeds and a re-fetch fails. */
let sealed = false;
const contracts: CollectionConfig = {
    slug: "contracts",
    name: "Contracts",
    engine: "mongodb",
    properties: { title: { name: "Title", type: "string" } },
    callbacks: {
        afterRead: ({ row }) => {
            if (sealed) throw new RebaseApiError("This contract is sealed.", { status: 403, code: "FORBIDDEN" });
            return row;
        }
    }
};

type Frame = { type: string; subscriptionId?: string; payload?: any; error?: string; rows?: unknown[] };

describe("Mongo realtime: a failed subscription fetch reaches the subscriber", () => {
    let mongo: MongoMemoryServer;
    let client: MongoClient;
    let db: Db;
    let realtime: MongoRealtimeService;
    let server: Server;
    let port: number;
    let seq = 0;
    const sockets: NodeWebSocket[] = [];
    const previousNodeEnv = process.env.NODE_ENV;

    /**
     * One subscription on its own socket. `next()` resolves with the frames
     * addressed to it, in order, and rejects when none arrives — which is what
     * a subscriber left loading looks like from outside.
     */
    async function subscribe(
        type: "subscribe_collection" | "subscribe_one",
        payload: Record<string, unknown>
    ): Promise<{ subscriptionId: string; next: () => Promise<Frame> }> {
        const subscriptionId = `sub-${++seq}`;
        const ws = new NodeWebSocket(`ws://localhost:${port}`);
        sockets.push(ws);
        const queued: Frame[] = [];
        const waiting: ((frame: Frame) => void)[] = [];
        ws.on("message", (data) => {
            const frame = JSON.parse(String(data)) as Frame;
            if (frame.subscriptionId !== subscriptionId) return;
            const waiter = waiting.shift();
            if (waiter) waiter(frame);
            else queued.push(frame);
        });
        await new Promise<void>((resolve, reject) => {
            ws.once("open", () => resolve());
            ws.once("error", reject);
        });
        ws.send(JSON.stringify({ type, payload: { ...payload, subscriptionId } }));

        const next = () => {
            const frame = queued.shift();
            if (frame) return Promise.resolve(frame);
            return new Promise<Frame>((resolve, reject) => {
                const waiter = (arrived: Frame) => {
                    clearTimeout(timer);
                    resolve(arrived);
                };
                const timer = setTimeout(() => {
                    waiting.splice(waiting.indexOf(waiter), 1);
                    reject(new Error(`No frame for ${subscriptionId}: the subscriber is still loading`));
                }, 5_000);
                waiting.push(waiter);
            });
        };
        return { subscriptionId, next };
    }

    async function insert(path: string, title: string): Promise<string> {
        // Straight into the database: going through `driver.save` would run
        // the collection's `afterRead` on the saved row, which refuses.
        const { insertedId } = await db.collection(path).insertOne({ title });
        return insertedId.toString();
    }

    beforeAll(async () => {
        process.env.NODE_ENV = "production";
        mongo = await MongoMemoryServer.create();
        client = new MongoClient(mongo.getUri());
        await client.connect();
        db = client.db("test");

        const registry = new MongoCollectionRegistry();
        registry.register(dossiers);
        registry.register(ledgers);
        registry.register(invoices);
        registry.register(contracts);
        realtime = new MongoRealtimeService(db);
        const driver = new MongoDriver(db, realtime, undefined, registry);

        server = createServer();
        createMongoWebSocket(server, realtime, driver, { requireAuth: false });
        await new Promise<void>(resolve => server.listen(0, resolve));
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("No server port");
        port = address.port;
    });

    afterAll(async () => {
        process.env.NODE_ENV = previousNodeEnv;
        for (const ws of sockets) ws.close();
        await realtime?.closeAll();
        await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
        await client?.close();
        await mongo?.stop();
    });

    it("answers a collection subscription refused by afterRead with its message and code", async () => {
        await insert("dossiers", "Operation Nightjar");

        const { subscriptionId, next } = await subscribe("subscribe_collection", { path: "dossiers" });

        // The shape the client routes by `subscriptionId` and reads with
        // `extractMessageError`: `payload.error.{message, code}`, plus the
        // top-level `error` its routing condition also accepts.
        expect(await next()).toEqual({
            type: "ERROR",
            subscriptionId,
            payload: { error: { message: "Dossiers are open to case officers only.", code: "FORBIDDEN" } },
            error: "Dossiers are open to case officers only."
        });
    });

    it("answers a row subscription refused by afterRead the same way", async () => {
        const id = await insert("dossiers", "Operation Kestrel");

        const { next } = await subscribe("subscribe_one", { path: "dossiers", id });

        const frame = await next();
        expect(frame.type).toBe("ERROR");
        expect(frame.payload.error).toEqual({ message: "Dossiers are open to case officers only.", code: "FORBIDDEN" });
    });

    it("masks a fault instead of passing its message on", async () => {
        const id = await insert("ledgers", "Q3");

        for (const [type, payload] of [
            ["subscribe_collection", { path: "ledgers" }],
            ["subscribe_one", { path: "ledgers", id }]
        ] as const) {
            const { subscriptionId, next } = await subscribe(type, payload);
            const frame = await next();

            expect(frame).toEqual({
                type: "ERROR",
                subscriptionId,
                payload: { error: {
                    message: "Could not load data for \"ledgers\". Check server logs for details.",
                    code: "INTERNAL_ERROR"
                } },
                error: "Could not load data for \"ledgers\". Check server logs for details."
            });
            expect(JSON.stringify(frame)).not.toMatch(/hunter2|10\.0\.0\.7|pool/);
        }
    });

    it("masks a declared 5xx as well", async () => {
        await insert("invoices", "INV-0042");

        const { subscriptionId, next } = await subscribe("subscribe_collection", { path: "invoices" });

        expect(await next()).toEqual({
            type: "ERROR",
            subscriptionId,
            payload: { error: {
                message: "Could not load data for \"invoices\". Check server logs for details.",
                code: "INTERNAL_ERROR"
            } },
            error: "Could not load data for \"invoices\". Check server logs for details."
        });
    });

    it("answers a re-fetch that fails after the subscription loaded", async () => {
        const id = await insert("contracts", "Supply agreement");
        sealed = false;

        const { subscriptionId, next } = await subscribe("subscribe_collection", { path: "contracts" });
        const loaded = await next();
        expect(loaded.type).toBe("collection_update");
        expect(loaded.rows).toHaveLength(1);

        // The push after a save. `driver.save` would run the sealed
        // `afterRead` on its own row and refuse before notifying, so the
        // notification is sent the way the save sends it.
        sealed = true;
        await realtime.notifyUpdate("contracts", id, { id, title: "Supply agreement" });

        expect(await next()).toEqual({
            type: "ERROR",
            subscriptionId,
            payload: { error: { message: "This contract is sealed.", code: "FORBIDDEN" } },
            error: "This contract is sealed."
        });
    });
});
