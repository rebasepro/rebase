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
 *
 * The in-process door had the same gap: `driver.listenCollection({ onError })`
 * passed the realtime service no error callback, so the listener heard
 * nothing either. It is trusted server code, so it gets the error as thrown,
 * unmasked.
 */
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { createServer, type Server } from "node:http";
import { WebSocket as NodeWebSocket } from "ws";
import { RebaseApiError, type CollectionConfig, type DataDriver, type User } from "@rebasepro/types";
import { MongoDriver } from "../src/services/MongoDriver";
import { MongoRealtimeService } from "../src/services/MongoRealtimeService";
import { MongoCollectionRegistry } from "../src/factory";
import { createMongoWebSocket } from "../src/websocket";

// One instance each, thrown on every read, so an in-process listener can be
// checked for the error as thrown rather than a copy of it.
const officersOnly = new RebaseApiError("Dossiers are open to case officers only.", { status: 403, code: "FORBIDDEN" });
const poolExhausted = new Error("pool for mongodb://ops:hunter2@10.0.0.7:27017 exhausted");
const contractSealed = new RebaseApiError("This contract is sealed.", { status: 403, code: "FORBIDDEN" });

/** Refuses every read, as a callback that gates a whole collection would. */
const dossiers: CollectionConfig = {
    slug: "dossiers",
    name: "Dossiers",
    engine: "mongodb",
    properties: { title: { name: "Title", type: "string" } },
    callbacks: {
        afterRead: () => {
            throw officersOnly;
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
            throw poolExhausted;
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
            if (sealed) throw contractSealed;
            return row;
        }
    }
};

type Frame = { type: string; subscriptionId?: string; payload?: any; error?: string; rows?: unknown[] };

/** What an in-process listener was handed, in the order it was handed it. */
type Heard = { rows: unknown } | { error: Error };

/** The error it was handed, or what it got instead, for `toBe` to name. */
const errorIn = (heard: Heard) => ("error" in heard ? heard.error : heard);

/**
 * Deliveries in arrival order. `next()` resolves with the next one and rejects
 * when none arrives in time, which is what a subscriber left waiting looks
 * like from outside.
 */
function inbox<T>(label: string) {
    const queued: T[] = [];
    const waiting: ((item: T) => void)[] = [];
    return {
        push(item: T) {
            const waiter = waiting.shift();
            if (waiter) waiter(item);
            else queued.push(item);
        },
        next(): Promise<T> {
            if (queued.length > 0) return Promise.resolve(queued.shift() as T);
            return new Promise<T>((resolve, reject) => {
                const waiter = (arrived: T) => {
                    clearTimeout(timer);
                    resolve(arrived);
                };
                const timer = setTimeout(() => {
                    waiting.splice(waiting.indexOf(waiter), 1);
                    reject(new Error(`Nothing arrived for ${label}: the subscriber is still waiting`));
                }, 5_000);
                waiting.push(waiter);
            });
        }
    };
}

describe("Mongo realtime: a failed subscription fetch reaches the subscriber", () => {
    let mongo: MongoMemoryServer;
    let client: MongoClient;
    let db: Db;
    let realtime: MongoRealtimeService;
    let driver: MongoDriver;
    let server: Server;
    let port: number;
    let seq = 0;
    const sockets: NodeWebSocket[] = [];
    const unsubscribes: (() => void)[] = [];
    const previousNodeEnv = process.env.NODE_ENV;

    /** One subscription on its own socket, with the frames addressed to it. */
    async function subscribe(
        type: "subscribe_collection" | "subscribe_one",
        payload: Record<string, unknown>
    ): Promise<{ subscriptionId: string; next: () => Promise<Frame> }> {
        const subscriptionId = `sub-${++seq}`;
        const frames = inbox<Frame>(subscriptionId);
        const ws = new NodeWebSocket(`ws://localhost:${port}`);
        sockets.push(ws);
        ws.on("message", (data) => {
            const frame = JSON.parse(String(data)) as Frame;
            if (frame.subscriptionId === subscriptionId) frames.push(frame);
        });
        await new Promise<void>((resolve, reject) => {
            ws.once("open", () => resolve());
            ws.once("error", reject);
        });
        ws.send(JSON.stringify({ type, payload: { ...payload, subscriptionId } }));
        return { subscriptionId, next: frames.next };
    }

    /** An in-process collection listener, as server code registers one. */
    function listenCollection(on: DataDriver, path: string) {
        if (!on.listenCollection) throw new Error("This driver cannot listen");
        const heard = inbox<Heard>(`the in-process listener on ${path}`);
        unsubscribes.push(on.listenCollection({
            path,
            onUpdate: (rows) => heard.push({ rows }),
            onError: (error) => heard.push({ error })
        }));
        return heard;
    }

    function listenOne(path: string, id: string) {
        const heard = inbox<Heard>(`the in-process listener on ${path}/${id}`);
        unsubscribes.push(driver.listenOne({
            path,
            id,
            onUpdate: (row) => heard.push({ rows: row }),
            onError: (error) => heard.push({ error })
        }));
        return heard;
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
        driver = new MongoDriver(db, realtime, undefined, registry);

        server = createServer();
        createMongoWebSocket(server, realtime, driver, { requireAuth: false });
        await new Promise<void>(resolve => server.listen(0, resolve));
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("No server port");
        port = address.port;
    });

    afterAll(async () => {
        process.env.NODE_ENV = previousNodeEnv;
        for (const unsubscribe of unsubscribes) unsubscribe();
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

    describe("in-process listeners", () => {
        it("hands a collection listener the refusal as thrown", async () => {
            await insert("dossiers", "Operation Merlin");

            const heard = listenCollection(driver, "dossiers");

            expect(errorIn(await heard.next())).toBe(officersOnly);
        });

        it("hands a row listener a fault unmasked", async () => {
            const id = await insert("ledgers", "Q4");

            const heard = listenOne("ledgers", id);

            // The instance itself, so trusted code reads the real diagnosis
            // the socket masks.
            expect(errorIn(await heard.next())).toBe(poolExhausted);
        });

        it("tells a listener on a scoped driver too", async () => {
            await insert("dossiers", "Operation Plover");
            const officer: User = {
                uid: "officer-7",
                displayName: null,
                email: null,
                photoURL: null,
                providerId: "password",
                isAnonymous: false,
                roles: []
            };

            const heard = listenCollection(await driver.withAuth(officer), "dossiers");

            expect(errorIn(await heard.next())).toBe(officersOnly);
        });

        it("tells a listener a re-fetch failed after it loaded", async () => {
            const id = await insert("contracts", "Framework agreement");
            sealed = false;

            const heard = listenCollection(driver, "contracts");
            expect(await heard.next()).toEqual({
                rows: expect.arrayContaining([expect.objectContaining({ title: "Framework agreement" })])
            });

            sealed = true;
            await realtime.notifyUpdate("contracts", id, { id, title: "Framework agreement" });

            expect(errorIn(await heard.next())).toBe(contractSealed);
        });
    });
});
