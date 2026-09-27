/**
 * What `afterSaveError` hands off outlives the write it is about.
 *
 * The hook is documented as the place to alert ("Use it to alert, not to
 * recover"), and the documented way to do a side effect is a job. On a request
 * the hook ran inside the write's own transaction scope — the one the failure
 * was about to roll back — so `jobs.enqueue("alert-ops", …)` returned an id and
 * then vanished with the rollback: no job, no webhook, nothing. The same hook on
 * the base driver kept its job, because there was no scope there.
 *
 * The hook now runs outside the failed write's scope, so what it enqueues
 * commits on its own. And it is guarded: a hook that throws is logged, and the
 * caller still gets the failure the write actually had.
 *
 * A real driver over PGlite, through `withAuth`, the way a request writes.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { pgTable, varchar } from "drizzle-orm/pg-core";
import type { CollectionCallbacks, CollectionConfig, DataDriver } from "@rebasepro/types";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";
import { createJobQueue, createJobStore } from "../../server/src/jobs";

const widgetsTable = pgTable("widgets", { id: varchar("id").primaryKey(), name: varchar("name") });

let hook: () => Promise<void>;

const callbacks: CollectionCallbacks = {
    afterSaveError: async () => hook()
};

const widgets = {
    name: "Widgets", slug: "widgets", table: "widgets",
    properties: { id: { name: "ID", type: "string", isId: "manual" }, name: { name: "Name", type: "string" } },
    callbacks
} as unknown as CollectionConfig;

let db: PGlite;
let user: DataDriver;
let queue: ReturnType<typeof createJobQueue>;

beforeEach(async () => {
    db = new PGlite();
    await db.waitReady;
    await db.exec(
        "CREATE TABLE widgets (id varchar PRIMARY KEY, name varchar UNIQUE);" +
        "INSERT INTO widgets VALUES ('w1', 'taken');"
    );
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([widgets]);
    registry.registerTable(widgetsTable, "widgets");
    const orm = drizzle(db, { schema: { widgets: widgetsTable } }) as never;
    const base = new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);
    const store = createJobStore(base)!;
    await store.ensureTable();
    queue = createJobQueue(store);
    user = await base.withAuth({ uid: "u1", roles: ["editor"] } as never);
});

afterEach(async () => {
    await db.close();
});

/** A create that hits the unique `name`, so the write fails in the database. */
const failingCreate = () =>
    user.save({ path: "widgets", values: { id: "w2", name: "taken" }, collection: widgets, status: "new" });

const alertJobs = async () =>
    (await db.query<{ c: number }>("SELECT count(*)::int AS c FROM rebase.jobs WHERE task = 'alert-ops'")).rows[0].c;

describe("afterSaveError on a request", () => {
    it("keeps the job it enqueues after the failed write rolls back", async () => {
        hook = async () => { await queue.enqueue("alert-ops", { widget: "w2" }); };

        await expect(failingCreate()).rejects.toThrow(/already exists/);

        expect(await alertJobs()).toBe(1);
    });

    it("answers with the write's own failure when the hook itself throws", async () => {
        hook = async () => { throw new Error("the pager is down"); };

        await expect(failingCreate()).rejects.toThrow(/already exists/);
    });
});
