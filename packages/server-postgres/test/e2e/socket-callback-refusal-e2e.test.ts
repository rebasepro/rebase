/**
 * E2E: the socket answers a collection-callback veto the way REST does.
 *
 * Every refusal a callback expresses — a throw from any of the four hooks, or
 * `beforeDelete` returning `false` — reaches the socket as a `RebaseApiError`
 * with `code: "CALLBACK_REJECTED"` (see `toCallbackError` / `callbackRefusal`).
 * REST answers it as 400 (or 403) with that code, the author's message and
 * `details.stage`. The socket's catch block recognised only the server's own
 * `ApiError`, so the same veto fell through to the generic branch:
 * `INTERNAL_ERROR`, and in production "An unexpected error occurred". The admin
 * panel writes through the socket, so that is what an editor was shown when a
 * rule refused their save.
 *
 * The suite runs with `NODE_ENV=production` because that is where the generic
 * branch drops the text — under `test` the old answer still carried the
 * message, and only the code was wrong.
 *
 * Nothing here is faked: a real Postgres, the real driver running the real
 * callbacks inside its write transaction, the real socket handler on a real
 * HTTP server, and a raw `ws` client reading the frame an admin panel reads.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { boolean, pgTable, varchar } from "drizzle-orm/pg-core";
import { createServer, type Server } from "node:http";
import { WebSocket as NodeWebSocket } from "ws";
import type { CollectionConfig } from "@rebasepro/types";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";
import { createPostgresWebSocket } from "../../src/websocket.js";

const contractsTable = pgTable("contracts", {
    id: varchar("id").primaryKey(),
    title: varchar("title"),
    locked: boolean("locked").notNull().default(false)
});

/** Registered and mapped, but never created — reading it is a genuine fault. */
const ghostsTable = pgTable("ghosts", {
    id: varchar("id").primaryKey()
});

const contractsCollection = {
    slug: "contracts",
    name: "Contracts",
    table: "contracts",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        title: { name: "Title", type: "string" },
        locked: { name: "Locked", type: "boolean" }
    },
    callbacks: {
        beforeSave: ({ values }: { values: Record<string, unknown> }) => {
            if (values.title === "Void") throw new Error("A contract cannot be titled Void.");
            return values;
        },
        afterSave: ({ values }: { values: Record<string, unknown> }) => {
            if (values.title === "Unsigned") throw new Error("Countersignature failed; the save was undone.");
        },
        beforeDelete: ({ row }: { row: Record<string, unknown> }) => {
            if (row.locked === true) throw new Error("This contract is under legal hold.");
            return row.id !== "c-quiet";
        },
        afterDelete: ({ row }: { row: Record<string, unknown> }) => {
            if (row.title === "Archived") throw new Error("The archive copy could not be written.");
        }
    }
} as unknown as CollectionConfig;

const ghostsCollection = {
    slug: "ghosts",
    name: "Ghosts",
    table: "ghosts",
    properties: { id: { name: "ID", type: "string", isId: true } }
} as unknown as CollectionConfig;

describe("the socket answers a callback veto as CALLBACK_REJECTED (E2E)", () => {
    let container: PgContainer;
    let observer: pg.Client;
    let pool: pg.Pool;
    let realtime: RealtimeService;
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

    const save = (id: string, values: Record<string, unknown>, status: "new" | "existing") => send({
        type: "SAVE",
        payload: { path: "contracts", id, values, status }
    });

    const remove = (id: string) => send({
        type: "DELETE",
        payload: { row: { id, path: "contracts" } }
    });

    async function stored(id: string): Promise<Record<string, unknown> | undefined> {
        return (await observer.query("SELECT * FROM public.contracts WHERE id = $1", [id])).rows[0];
    }

    beforeAll(async () => {
        process.env.NODE_ENV = "production";
        container = await startPgContainer();
        for (let i = 0; ; i++) {
            try {
                observer = new pg.Client({ connectionString: container.connectionString });
                await observer.connect();
                break;
            } catch (e) {
                if (i >= 10) throw e;
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        await observer.query(`
            CREATE TABLE public.contracts (
                id varchar PRIMARY KEY,
                title varchar,
                locked boolean NOT NULL DEFAULT false
            );
        `);

        pool = new pg.Pool({ connectionString: container.connectionString });
        const db = drizzle(pool);

        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple([contractsCollection, ghostsCollection]);
        registry.registerTable(contractsTable, "contracts");
        registry.registerTable(ghostsTable, "ghosts");

        realtime = new RealtimeService(db as never, registry);
        const driver = new PostgresBackendDriver(db as never, realtime as never, registry);
        realtime.setDataDriver(driver);

        server = createServer();
        createPostgresWebSocket(server, realtime, driver, { requireAuth: false });
        await new Promise<void>(resolve => server.listen(0, resolve));
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("No server port");
        port = address.port;
    }, 120_000);

    afterAll(async () => {
        process.env.NODE_ENV = previousNodeEnv;
        await realtime?.destroy();
        await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
        await observer?.end();
        await pool?.end();
        if (container) await stopPgContainer(container.containerName);
    }, 30_000);

    beforeEach(async () => {
        await observer.query("DELETE FROM public.contracts");
        await observer.query(`
            INSERT INTO public.contracts (id, title, locked) VALUES
                ('c-open',     'Supply agreement', false),
                ('c-locked',   'Under legal hold', true),
                ('c-quiet',    'Silently kept',    false),
                ('c-archived', 'Archived',         false)
        `);
    });

    it("answers a beforeDelete throw with the author's message and the stage", async () => {
        const reply = await remove("c-locked");

        expect(reply).toEqual({
            type: "ERROR",
            requestId: expect.any(String),
            payload: { error: {
                message: "This contract is under legal hold.",
                code: "CALLBACK_REJECTED",
                details: { stage: "beforeDelete", path: "contracts" }
            } }
        });
        expect(await stored("c-locked")).toBeDefined();
    });

    it("answers a beforeDelete that returns false as CALLBACK_REJECTED", async () => {
        const reply = await remove("c-quiet");

        expect(reply.payload.error).toEqual({
            message: "beforeDelete refused the operation",
            code: "CALLBACK_REJECTED",
            details: { stage: "beforeDelete", path: "contracts" }
        });
        expect(await stored("c-quiet")).toBeDefined();
    });

    it("answers a beforeSave throw, and nothing is written", async () => {
        const reply = await save("c-void", { title: "Void" }, "new");

        expect(reply.payload.error).toEqual({
            message: "A contract cannot be titled Void.",
            code: "CALLBACK_REJECTED",
            details: { stage: "beforeSave", path: "contracts" }
        });
        expect(await stored("c-void")).toBeUndefined();
    });

    it("answers an afterSave throw naming afterSave, and the update is rolled back", async () => {
        const reply = await save("c-open", { title: "Unsigned" }, "existing");

        expect(reply.payload.error).toEqual({
            message: "Countersignature failed; the save was undone.",
            code: "CALLBACK_REJECTED",
            details: { stage: "afterSave", path: "contracts" }
        });
        expect(await stored("c-open")).toMatchObject({ title: "Supply agreement" });
    });

    it("answers an afterDelete throw naming afterDelete, and the row is still there", async () => {
        const reply = await remove("c-archived");

        expect(reply.payload.error).toEqual({
            message: "The archive copy could not be written.",
            code: "CALLBACK_REJECTED",
            details: { stage: "afterDelete", path: "contracts" }
        });
        expect(await stored("c-archived")).toBeDefined();
    });

    it("still succeeds when no rule refuses", async () => {
        expect((await remove("c-open")).type).toBe("DELETE_SUCCESS");
        expect(await stored("c-open")).toBeUndefined();
    });

    it("still masks a genuine server fault", async () => {
        // The other half of the contract: recognising a refusal must not
        // unmask everything else. A table the registry maps and the database
        // lacks is a server fault, and its text names schema internals.
        const reply = await send({ type: "FETCH_COLLECTION", payload: { path: "ghosts" } });

        expect(reply.payload.error).toEqual({
            message: "An unexpected error occurred",
            code: "INTERNAL_ERROR"
        });
    });
});
