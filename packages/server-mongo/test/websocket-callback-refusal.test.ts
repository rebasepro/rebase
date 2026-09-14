/**
 * The Mongo socket answers a collection-callback veto the way REST does.
 *
 * A `beforeSave` or `beforeDelete` refusal reaches the socket as a
 * `RebaseApiError` with `code: "CALLBACK_REJECTED"`. The catch block recognised
 * only the server's own `ApiError`, so the veto fell through to the generic
 * branch: `INTERNAL_ERROR`, and in production "An unexpected error occurred" —
 * while REST answered the same veto 400 with the author's message.
 *
 * `NODE_ENV=production` for the whole file, since that is where the generic
 * branch drops the text. A real mongod, the real driver running the real
 * callbacks, the real socket handler on a real HTTP server, and a raw `ws`
 * client — the Postgres half is `test/e2e/socket-callback-refusal-e2e.test.ts`
 * in that package.
 */
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { createServer, type Server } from "node:http";
import { WebSocket as NodeWebSocket } from "ws";
import type { CollectionConfig } from "@rebasepro/types";
import { MongoDriver } from "../src/services/MongoDriver";
import { MongoRealtimeService } from "../src/services/MongoRealtimeService";
import { MongoCollectionRegistry } from "../src/factory";
import { createMongoWebSocket } from "../src/websocket";

const contracts: CollectionConfig = {
    slug: "contracts",
    name: "Contracts",
    engine: "mongodb",
    properties: {
        title: { name: "Title", type: "string" },
        locked: { name: "Locked", type: "boolean" }
    },
    callbacks: {
        beforeSave: ({ values }) => {
            if (values.title === "Void") throw new Error("A contract cannot be titled Void.");
            return values;
        },
        beforeDelete: ({ row }) => {
            if (row.locked === true) throw new Error("This contract is under legal hold.");
            return row.title !== "Silently kept";
        }
    }
};

describe("Mongo socket: a callback veto is CALLBACK_REJECTED", () => {
    let mongo: MongoMemoryServer;
    let client: MongoClient;
    let driver: MongoDriver;
    let server: Server;
    let port: number;
    let seq = 0;
    const previousNodeEnv = process.env.NODE_ENV;

    /** One frame on a fresh socket, answered by its `requestId`. */
    function send(frame: { type: string; payload: unknown }): Promise<{ type: string; payload: any }> {
        const requestId = `r-${++seq}`;
        return new Promise((resolve, reject) => {
            const ws = new NodeWebSocket(`ws://localhost:${port}`);
            const timer = setTimeout(() => {
                ws.close();
                reject(new Error(`No answer to ${frame.type} ${requestId}`));
            }, 20_000);
            ws.on("open", () => ws.send(JSON.stringify({ ...frame, requestId })));
            ws.on("message", (data) => {
                const message = JSON.parse(String(data));
                if (message.requestId !== requestId) return;
                clearTimeout(timer);
                ws.close();
                resolve(message);
            });
            ws.on("error", (error) => {
                clearTimeout(timer);
                reject(error);
            });
        });
    }

    async function insert(values: Record<string, unknown>): Promise<string> {
        const row = await driver.save({ path: "contracts", values, collection: contracts, status: "new" });
        return String(row.id);
    }

    const stillThere = async (id: string) =>
        (await driver.fetchOne({ path: "contracts", id, collection: contracts })) !== undefined;

    beforeAll(async () => {
        process.env.NODE_ENV = "production";
        mongo = await MongoMemoryServer.create();
        client = new MongoClient(mongo.getUri());
        await client.connect();
        const db = client.db("test");

        const registry = new MongoCollectionRegistry();
        registry.register(contracts);
        const realtime = new MongoRealtimeService(db);
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
        await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
        await client?.close();
        await mongo?.stop();
    });

    it("answers a beforeDelete throw with the author's message and the stage", async () => {
        const id = await insert({ title: "Under legal hold", locked: true });

        const reply = await send({ type: "DELETE", payload: { row: { id, path: "contracts" } } });

        expect(reply).toEqual({
            type: "ERROR",
            requestId: expect.any(String),
            payload: { error: {
                message: "This contract is under legal hold.",
                code: "CALLBACK_REJECTED",
                details: { stage: "beforeDelete", path: "contracts" }
            } }
        });
        expect(await stillThere(id)).toBe(true);
    });

    it("answers a beforeDelete that returns false as CALLBACK_REJECTED", async () => {
        const id = await insert({ title: "Silently kept", locked: false });

        const reply = await send({ type: "DELETE", payload: { row: { id, path: "contracts" } } });

        expect(reply.payload.error).toEqual({
            message: "beforeDelete refused the operation",
            code: "CALLBACK_REJECTED",
            details: { stage: "beforeDelete", path: "contracts" }
        });
        expect(await stillThere(id)).toBe(true);
    });

    it("answers a beforeSave throw with the author's message and the stage", async () => {
        const reply = await send({
            type: "SAVE",
            payload: { path: "contracts", values: { title: "Void" }, status: "new" }
        });

        expect(reply.payload.error).toEqual({
            message: "A contract cannot be titled Void.",
            code: "CALLBACK_REJECTED",
            details: { stage: "beforeSave", path: "contracts" }
        });
    });

    it("still succeeds when no rule refuses", async () => {
        const id = await insert({ title: "Supply agreement", locked: false });

        expect((await send({ type: "DELETE", payload: { row: { id, path: "contracts" } } })).type).toBe("DELETE_SUCCESS");
        expect(await stillThere(id)).toBe(false);
    });
});
