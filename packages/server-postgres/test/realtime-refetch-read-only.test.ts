/**
 * A realtime frame is a read, and is read the way a request is: `READ ONLY`.
 *
 * An `afterRead` that writes — a read log, "last viewed", a view counter — is
 * refused with 25006 on every request read (409 `READ_ONLY_TRANSACTION`). The
 * subscription refetches ran the same hook in a read-write transaction, so on
 * the socket door the write committed: once per row, per subscriber, on every
 * change anyone made. A frame now opens its transaction `READ ONLY`, for the
 * rows, for their count and for a single-row subscription alike.
 *
 * A real driver over PGlite, subscribed the way the SDK subscribes.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { pgTable, varchar } from "drizzle-orm/pg-core";
import type { CollectionCallbacks, CollectionConfig, DataDriver } from "@rebasepro/types";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";

const widgetsTable = pgTable("widgets", { id: varchar("id").primaryKey(), name: varchar("name") });
const readLogTable = pgTable("read_log", { id: varchar("id").primaryKey(), widget: varchar("widget") });

let hookRuns = 0;
let refusals: string[] = [];
let logId = 0;

const callbacks: CollectionCallbacks = {
    // "Record who read what": a write the docs say an afterRead may not make.
    afterRead: async ({ row, context }) => {
        hookRuns++;
        try {
            await (context.data as never as Record<string, { create(v: unknown): Promise<unknown> }>)
                .read_log.create({ id: `r${++logId}`, widget: String(row.id) });
        } catch (error) {
            refusals.push(String((error as Error).message));
        }
        return row;
    }
};

const widgets = {
    name: "Widgets", slug: "widgets", table: "widgets",
    properties: { id: { name: "ID", type: "string", isId: "manual" }, name: { name: "Name", type: "string" } },
    callbacks
} as unknown as CollectionConfig;
const readLog = {
    name: "Read log", slug: "read_log", table: "read_log",
    properties: { id: { name: "ID", type: "string", isId: "manual" }, widget: { name: "Widget", type: "string" } }
} as unknown as CollectionConfig;

let db: PGlite;
let realtime: RealtimeService;
let user: DataDriver;

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const logged = async () => (await db.query<{ c: number }>("SELECT count(*)::int AS c FROM read_log")).rows[0].c;

beforeEach(async () => {
    hookRuns = 0;
    refusals = [];
    db = new PGlite();
    await db.waitReady;
    await db.exec(
        "CREATE TABLE widgets (id varchar PRIMARY KEY, name varchar);" +
        "CREATE TABLE read_log (id varchar PRIMARY KEY, widget varchar);" +
        "INSERT INTO widgets VALUES ('w1', 'one'), ('w2', 'two');"
    );
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([widgets, readLog]);
    registry.registerTable(widgetsTable, "widgets");
    registry.registerTable(readLogTable, "read_log");
    const orm = drizzle(db, { schema: { widgets: widgetsTable, read_log: readLogTable } }) as never;
    realtime = new RealtimeService(orm, registry);
    const base = new PostgresBackendDriver(orm, realtime, registry);
    realtime.setDataDriver(base);
    user = await base.withAuth({ uid: "u1", roles: ["editor"] } as never);
});

afterEach(async () => {
    await realtime.destroy();
    await db.close();
});

describe("a subscription frame", () => {
    it("refuses an afterRead's write on a collection refetch, as a request read does", async () => {
        const frames: unknown[] = [];
        const unsubscribe = user.listenCollection!({ path: "widgets", collection: widgets, onUpdate: (rows) => frames.push(rows) });
        await wait(100);
        hookRuns = 0;
        refusals = [];

        await realtime.notifyUpdate("widgets", "w1", null);
        await wait(600);
        unsubscribe();

        expect(hookRuns).toBe(2);
        expect(refusals).toHaveLength(2);
        expect(refusals[0]).toMatch(/read-only transaction/);
        expect(await logged()).toBe(0);
    });

    it("refuses it on a single-row refetch too", async () => {
        const unsubscribe = user.listenOne!({ path: "widgets", id: "w1", collection: widgets, onUpdate: () => undefined });
        await wait(100);
        hookRuns = 0;
        refusals = [];

        await realtime.notifyUpdate("widgets", "w1", null);
        await wait(600);
        unsubscribe();

        expect(hookRuns).toBe(1);
        expect(refusals[0]).toMatch(/read-only transaction/);
        expect(await logged()).toBe(0);
    });
});
