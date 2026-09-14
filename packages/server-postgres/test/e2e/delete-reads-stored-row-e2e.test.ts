/**
 * E2E: a delete judges and records the row that is stored, not the one the
 * caller describes.
 *
 * `DeleteProps` used to carry `row.values`, and the driver took it as the row:
 * it was what `beforeDelete` and `afterDelete` received and what the history
 * entry recorded as the deleted row's final state. The REST routes filled it
 * from a read of their own, so over HTTP it was true. The WebSocket `DELETE`
 * handler forwarded the client's frame, so over the socket it was whatever the
 * client sent — and the in-process SDK sent `{}`, so there it was nothing.
 *
 * Two consequences, both reachable by any caller allowed to delete a row:
 *
 * - The audit log's record of a deletion was written by the party deleting.
 * - A `beforeDelete` that refuses on the row's contents — the one the callbacks
 *   guide shows, `if (row.status === "published") throw` — was bypassed by
 *   sending `values: {}`.
 *
 * Nothing here is faked: a real Postgres with the history table and the
 * restricted request role, the real socket handler on a real HTTP server, and
 * a raw `ws` client sending the frame an attacker would send.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { boolean, pgTable, varchar } from "drizzle-orm/pg-core";
import { createServer, type Server } from "node:http";
import { WebSocket as NodeWebSocket } from "ws";
import type { CollectionConfig, RebaseSdkData } from "@rebasepro/types";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";
import { HistoryService } from "../../src/history/HistoryService.js";
import { ensureHistoryTableExists } from "../../src/history/ensure-history-table.js";
import { ensureAppRole, REBASE_USER_ROLE } from "../../src/security/rls-enforcement.js";
import { createPostgresWebSocket } from "../../src/websocket.js";

const contractsTable = pgTable("contracts", {
    id: varchar("id").primaryKey(),
    title: varchar("title"),
    locked: boolean("locked").notNull().default(false),
    owner_id: varchar("owner_id")
});

/** What the delete callbacks were handed, in order. */
let seen: { stage: "beforeDelete" | "afterDelete"; id: string | number; row: Record<string, unknown> }[] = [];

const contractsCollection = {
    slug: "contracts",
    name: "Contracts",
    table: "contracts",
    history: true,
    properties: {
        id: { name: "ID", type: "string", isId: true },
        title: { name: "Title", type: "string" },
        locked: { name: "Locked", type: "boolean" },
        owner_id: { name: "Owner", type: "string" }
    },
    callbacks: {
        // The veto the callbacks guide documents, on a column.
        beforeDelete: ({ id, row }: { id: string | number; row: Record<string, unknown> }) => {
            seen.push({ stage: "beforeDelete", id, row: { ...row } });
            if (row.locked === true) throw new Error("This contract is under legal hold.");
        },
        afterDelete: ({ id, row }: { id: string | number; row: Record<string, unknown> }) => {
            seen.push({ stage: "afterDelete", id, row: { ...row } });
        }
    }
} as unknown as CollectionConfig;

describe("a delete reads the row it deletes (E2E)", () => {
    let container: PgContainer;
    let observer: pg.Client;
    let pool: pg.Pool;
    let driver: PostgresBackendDriver;
    let realtime: RealtimeService;
    let server: Server;
    let port: number;
    let seq = 0;

    /**
     * One frame on a fresh anonymous socket, answered by its `requestId`.
     *
     * Anonymous because the socket runs `requireAuth: false`: its writes still
     * go through `driver.withAuth`, as uid `anonymous` under the restricted
     * role, so the policies below bind every statement exactly as they bind a
     * signed-in user's.
     */
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

    const deleteFrame = (id: string, row: Record<string, unknown>) => ({
        type: "DELETE",
        payload: { row: { id, path: "contracts", ...row } }
    });

    async function stillThere(id: string): Promise<boolean> {
        return (await observer.query("SELECT 1 FROM public.contracts WHERE id = $1", [id])).rowCount === 1;
    }

    /** The `values` of every `delete` entry the trail holds for this row. */
    async function deletionRecords(id: string): Promise<Record<string, unknown>[]> {
        const r = await observer.query(
            `SELECT "values" FROM rebase.entity_history
             WHERE table_name = 'contracts' AND entity_id = $1 AND action = 'delete'`,
            [id]
        );
        return r.rows.map(row => row.values);
    }

    beforeAll(async () => {
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

        // Owner-scoped for every command, keyed on the uid the request
        // transaction sets. `observer` is the superuser and sees everything.
        await observer.query(`
            CREATE SCHEMA IF NOT EXISTS rebase;
            CREATE TABLE public.contracts (
                id varchar PRIMARY KEY,
                title varchar,
                locked boolean NOT NULL DEFAULT false,
                owner_id varchar
            );
            ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
            CREATE POLICY contracts_own ON public.contracts FOR ALL TO public
                USING (owner_id = current_setting('app.uid', true))
                WITH CHECK (owner_id = current_setting('app.uid', true));
        `);

        pool = new pg.Pool({ connectionString: container.connectionString });
        const db = drizzle(pool);

        // Boot order, as the bootstrapper runs it: the restricted role, then
        // history — which routes a write's entry through its own transaction.
        await ensureAppRole(async (text) => (await pool.query(text)).rows as Record<string, unknown>[], ["public", "rebase"]);
        const historyInTransaction = await ensureHistoryTableExists(db as never);
        expect(historyInTransaction).toBe(true);

        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple([contractsCollection]);
        registry.registerTable(contractsTable, "contracts");

        realtime = new RealtimeService(db as never, registry);
        driver = new PostgresBackendDriver(
            db as never, realtime as never, registry,
            undefined, undefined, new HistoryService(db as never, undefined, { inTransaction: historyInTransaction })
        );
        driver.rlsUserRole = REBASE_USER_ROLE;
        realtime.setDataDriver(driver);

        server = createServer();
        createPostgresWebSocket(server, realtime, driver, { requireAuth: false });
        await new Promise<void>(resolve => server.listen(0, resolve));
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("No server port");
        port = address.port;
    }, 120_000);

    afterAll(async () => {
        await realtime?.destroy();
        await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
        await observer?.end();
        await pool?.end();
        if (container) await stopPgContainer(container.containerName);
    }, 30_000);

    beforeEach(async () => {
        seen = [];
        await observer.query("DELETE FROM public.contracts");
        await observer.query("DELETE FROM rebase.entity_history");
        await observer.query(`
            INSERT INTO public.contracts (id, title, locked, owner_id) VALUES
                ('c-open',   'Supply agreement',  false, 'anonymous'),
                ('c-locked', 'Under legal hold',  true,  'anonymous'),
                ('c-theirs', 'Someone else''s',   false, 'user-b'),
                ('c-sdk',    'Deleted in process', false, 'sdk-user')
        `);
    });

    it("records the stored row as the deleted row, not the one the socket sent", async () => {
        const reply = await send(deleteFrame("c-open", {
            values: { title: "Nothing to see here", locked: false, forged: true }
        }));

        expect(reply.type).toBe("DELETE_SUCCESS");
        expect(await stillThere("c-open")).toBe(false);

        const records = await deletionRecords("c-open");
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({ id: "c-open", title: "Supply agreement", locked: false, owner_id: "anonymous" });
        expect(records[0]).not.toHaveProperty("forged");
    });

    it("hands both callbacks the stored row", async () => {
        await send(deleteFrame("c-open", { values: { title: "Nothing to see here" } }));

        expect(seen.map(s => s.stage)).toEqual(["beforeDelete", "afterDelete"]);
        for (const { id, row } of seen) {
            expect(id).toBe("c-open");
            expect(row).toMatchObject({ title: "Supply agreement", locked: false });
        }
    });

    // Three spellings of the same bypass: a forged column, the empty object
    // every SDK `delete(id)` has always sent, and no `values` at all.
    it.each([
        ["a forged column", { values: { locked: false } }],
        ["the empty values an SDK delete sends", { values: {} }],
        ["no values at all", {}]
    ])("keeps a beforeDelete veto on a stored column when the frame carries %s", async (_label, row) => {
        const reply = await send(deleteFrame("c-locked", row));

        expect(reply.type).toBe("ERROR");
        expect(await stillThere("c-locked")).toBe(true);
        expect(await deletionRecords("c-locked")).toEqual([]);
        expect(seen).toEqual([
            { stage: "beforeDelete", id: "c-locked", row: expect.objectContaining({ locked: true }) }
        ]);
    });

    it("answers 404 for a row the caller cannot read, before any callback runs", async () => {
        // The frame claims the row is the caller's own and unlocked. The read
        // runs under the caller's policies, so for this caller there is no
        // such row — and a callback handed a description of it instead would
        // be judging a row it may not even see.
        const reply = await send(deleteFrame("c-theirs", {
            values: { owner_id: "anonymous", locked: false }
        }));

        expect(reply).toMatchObject({ type: "ERROR", payload: { error: { code: "NOT_FOUND" } } });
        expect(seen).toEqual([]);
        expect(await stillThere("c-theirs")).toBe(true);
        expect(await deletionRecords("c-theirs")).toEqual([]);
    });

    it("takes the collection from the registry, not from the frame", async () => {
        // The driver merges a caller's `collection` under the registry's, so a
        // key the registry does not declare survives — and `softDelete` names
        // the column a soft delete stamps. Sent over the socket, it turned
        // this DELETE into an UPDATE of `title`: no `beforeSave`, no write
        // validators, and a history entry saying the row was deleted.
        const reply = await send({
            type: "DELETE",
            payload: {
                row: { id: "c-open", path: "contracts" },
                collection: { slug: "contracts", softDelete: { field: "title" } }
            }
        });

        expect(reply.type).toBe("DELETE_SUCCESS");
        expect(await stillThere("c-open")).toBe(false);
    });

    it("records the stored row for an in-process SDK delete, which sends none", async () => {
        const scoped = await driver.withAuth({ uid: "sdk-user", roles: [] } as never);
        const data = scoped.data as RebaseSdkData & Record<string, { delete(id: string): Promise<void> }>;

        await data.contracts.delete("c-sdk");

        expect(await stillThere("c-sdk")).toBe(false);
        const records = await deletionRecords("c-sdk");
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({ id: "c-sdk", title: "Deleted in process", owner_id: "sdk-user" });
        expect(seen[0]).toMatchObject({ stage: "beforeDelete", row: { title: "Deleted in process" } });
    });
});
