/**
 * A realtime refetch runs on behalf of the backend that owns the service.
 *
 * A change schedules its subscribers' refetch on a timer, and a timer runs in
 * the async context of whatever armed it. A write through this backend armed
 * it inside the backend's scope; a change-capture notification armed it in the
 * LISTEN connection's context, which is no backend's. There, an `afterRead`
 * importing `rebase` reached the process default — another backend's database
 * with two in one process — or threw "not initialized". The backend hands its
 * service a scope runner (`setScopeRunner`) and every group refetch runs in it.
 *
 * A real driver over PGlite. The change is announced from outside any scope,
 * as the LISTEN connection announces it.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { pgTable, varchar } from "drizzle-orm/pg-core";
import type { CollectionCallbacks, CollectionConfig, DataDriver, RebaseServerClient } from "@rebasepro/types";
import { rebase } from "@rebasepro/server";

import { runInBackendScope } from "../../server/src/backend/scope";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";

const widgetsTable = pgTable("widgets", { id: varchar("id").primaryKey(), name: varchar("name") });

/** What the hook's imported `rebase` reached, one entry per row read. */
let seen: string[] = [];

const callbacks: CollectionCallbacks = {
    afterRead: async ({ row }) => {
        try {
            const [answer] = await rebase.sql("SELECT 'which backend' AS name");
            seen.push(String(answer?.name));
        } catch (error) {
            seen.push(`threw: ${(error as Error).message}`);
        }
        return row;
    }
};

const widgets = {
    name: "Widgets", slug: "widgets", table: "widgets",
    properties: { id: { name: "ID", type: "string", isId: "manual" }, name: { name: "Name", type: "string" } },
    callbacks
} as unknown as CollectionConfig;

/** The owning backend's client, as far as the hook can tell: its `sql` names it. */
const backendB = { sql: async () => [{ name: "B" }] } as unknown as RebaseServerClient;

let db: PGlite;
let realtime: RealtimeService;
let user: DataDriver;

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

beforeEach(async () => {
    seen = [];
    db = new PGlite();
    await db.waitReady;
    await db.exec("CREATE TABLE widgets (id varchar PRIMARY KEY, name varchar); INSERT INTO widgets VALUES ('w1', 'one');");
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([widgets]);
    registry.registerTable(widgetsTable, "widgets");
    const orm = drizzle(db, { schema: { widgets: widgetsTable } }) as never;
    realtime = new RealtimeService(orm, registry);
    const base = new PostgresBackendDriver(orm, realtime, registry);
    realtime.setDataDriver(base);
    user = await base.withAuth({ uid: "u1", roles: ["editor"] } as never);
});

afterEach(async () => {
    await realtime.destroy();
    await db.close();
});

describe("a refetch scheduled from outside any backend's scope", () => {
    it("runs its hooks with the owning backend as rebase", async () => {
        realtime.setScopeRunner((fn) => runInBackendScope({ rebase: backendB }, fn));
        const unsubscribe = user.listenCollection!({ path: "widgets", collection: widgets, onUpdate: () => undefined });
        await wait(100);
        seen = [];

        await realtime.notifyUpdate("widgets", "w1", null);
        await wait(600);
        unsubscribe();

        expect(seen).toEqual(["B"]);
    });

    it("and a single-row subscription's too", async () => {
        realtime.setScopeRunner((fn) => runInBackendScope({ rebase: backendB }, fn));
        const unsubscribe = user.listenOne!({ path: "widgets", id: "w1", collection: widgets, onUpdate: () => undefined });
        await wait(100);
        seen = [];

        await realtime.notifyUpdate("widgets", "w1", null);
        await wait(600);
        unsubscribe();

        expect(seen).toEqual(["B"]);
    });
});
