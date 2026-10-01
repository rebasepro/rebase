/**
 * A statement that fails on a write's transaction aborts the transaction, and
 * catching its error in a callback does not un-abort it.
 *
 * Postgres answers the COMMIT of an aborted transaction with the tag
 * `ROLLBACK` and no error, so node-postgres and PGlite both resolve it. A
 * callback that wrapped something "best effort" in `try/catch` — a lookup
 * through `context.data` with a value the column cannot hold, a job the store
 * refused — left the request's transaction aborted, `withTransaction` returned
 * normally, and the save resolved with the row while nothing was stored. The
 * caller got 200/201, webhooks and realtime fired for a row that does not
 * exist.
 *
 * The contract now: a write whose transaction a caught failure aborted is
 * refused with `TRANSACTION_ABORTED`, and rolled back, before anything is told
 * it happened. A caught failure of a nested `context.data` *write* is still
 * contained — that write runs in a savepoint, is undone on its own, and the
 * rest commits, as `callbacks.md` documents.
 *
 * A real driver over PGlite (a real Postgres), through `withAuth`, the way
 * every request door writes.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { integer, pgTable, serial, varchar } from "drizzle-orm/pg-core";
import type { CollectionCallbacks, CollectionConfig, DataDriver } from "@rebasepro/types";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";
import { createJobQueue, createJobStore } from "../../server/src/jobs";

const ordersTable = pgTable("orders", { id: varchar("id").primaryKey(), customer: varchar("customer") });
const customersTable = pgTable("customers", { id: serial("id").primaryKey(), name: varchar("name"), orders: integer("orders") });
const auditTable = pgTable("audit", { id: serial("id").primaryKey(), note: varchar("note") });
const ownersTable = pgTable("owners", { id: serial("id").primaryKey(), name: varchar("name") });
const docsTable = pgTable("docs", { id: serial("id").primaryKey(), title: varchar("title"), ownerId: integer("owner_id") });

type Sdk = Record<string, {
    find(p: unknown): Promise<unknown>;
    create(v: unknown): Promise<unknown>;
    delete(id: unknown): Promise<unknown>;
}>;

/** What the callback under test does inside its `try`. Swapped per test. */
let attempt: (data: Sdk) => Promise<unknown>;
let caught: unknown;

const bestEffort = async (data: Sdk) => {
    try {
        await attempt(data);
    } catch (error) {
        caught = error;
    }
};

const callbacks: CollectionCallbacks = {
    afterSave: async ({ context }) => bestEffort(context.data as never as Sdk),
    afterDelete: async ({ context }) => bestEffort(context.data as never as Sdk)
};

const orders = {
    name: "Orders", slug: "orders", table: "orders",
    properties: {
        id: { name: "ID", type: "string", isId: "manual" },
        customer: { name: "Customer", type: "string" }
    },
    callbacks
} as unknown as CollectionConfig;
const customers = {
    name: "Customers", slug: "customers", table: "customers",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        name: { name: "Name", type: "string" },
        orders: { name: "Orders", type: "number" }
    }
} as unknown as CollectionConfig;
const audit = {
    name: "Audit", slug: "audit", table: "audit",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        note: { name: "Note", type: "string" }
    }
} as unknown as CollectionConfig;

const docs = {
    name: "Docs", slug: "docs", table: "docs",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        title: { name: "Title", type: "string" }
    }
} as unknown as CollectionConfig;
const owners = {
    name: "Owners", slug: "owners", table: "owners",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        name: { name: "Name", type: "string" },
        mainDoc: { name: "Main doc", type: "relation", relation: { kind: "hasOne", target: () => docs, foreignKeyOnTarget: "owner_id" } }
    }
} as unknown as CollectionConfig;

let db: PGlite;
let realtime: RealtimeService;
let user: DataDriver;
let queue: ReturnType<typeof createJobQueue>;

beforeEach(async () => {
    caught = undefined;
    db = new PGlite();
    await db.waitReady;
    await db.exec(
        "CREATE TABLE orders (id varchar PRIMARY KEY, customer varchar);" +
        "CREATE TABLE customers (id serial PRIMARY KEY, name varchar, orders integer);" +
        "CREATE TABLE audit (id serial PRIMARY KEY, note varchar UNIQUE);" +
        "INSERT INTO audit (note) VALUES ('taken');" +
        "CREATE TABLE owners (id serial PRIMARY KEY, name varchar);" +
        "CREATE TABLE docs (id serial PRIMARY KEY, title varchar, owner_id integer);" +
        "INSERT INTO docs (title) VALUES ('frozen');" +
        "CREATE FUNCTION refuse_doc_update() RETURNS trigger LANGUAGE plpgsql AS " +
        "$$ BEGIN RAISE EXCEPTION 'docs are frozen'; END $$;" +
        "CREATE TRIGGER docs_frozen BEFORE UPDATE ON docs FOR EACH ROW EXECUTE FUNCTION refuse_doc_update();" +
        // The database refusing a delete — what an FK RESTRICT answers, 23503.
        "CREATE FUNCTION refuse_audit_delete() RETURNS trigger LANGUAGE plpgsql AS " +
        "$$ BEGIN RAISE EXCEPTION 'audit rows are kept' USING ERRCODE = '23503'; END $$;" +
        "CREATE TRIGGER audit_kept BEFORE DELETE ON audit FOR EACH ROW EXECUTE FUNCTION refuse_audit_delete();"
    );
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([orders, customers, audit, owners, docs]);
    registry.registerTable(ordersTable, "orders");
    registry.registerTable(customersTable, "customers");
    registry.registerTable(auditTable, "audit");
    registry.registerTable(ownersTable, "owners");
    registry.registerTable(docsTable, "docs");
    const orm = drizzle(db, {
        schema: { orders: ordersTable, customers: customersTable, audit: auditTable, owners: ownersTable, docs: docsTable }
    }) as never;
    realtime = new RealtimeService(orm, registry);
    jest.spyOn(realtime, "notifyUpdate");
    const base = new PostgresBackendDriver(orm, realtime, registry);
    const store = createJobStore(base)!;
    await store.ensureTable();
    queue = createJobQueue(store);
    user = await base.withAuth({ uid: "u1", roles: ["editor"] } as never);
});

afterEach(async () => {
    jest.restoreAllMocks();
    await db.close();
});

const stored = async (id: string) =>
    (await db.query<{ c: number }>("SELECT count(*)::int AS c FROM orders WHERE id = $1", [id])).rows[0].c;

const create = (id: string) =>
    user.save({ path: "orders", values: { id, customer: "ACME Ltd" }, collection: orders, status: "new" });

const refusedAsAborted = expect.objectContaining({ statusCode: 500, code: "TRANSACTION_ABORTED" });

describe("a failed statement a callback caught", () => {
    it("refuses the write when the caught failure was a read, and stores nothing", async () => {
        // An integer column met with free text: 22P02 on the write's own transaction.
        attempt = (data) => data.customers.find({ where: { orders: "eq.ACME Ltd" } });

        await expect(create("o1")).rejects.toEqual(refusedAsAborted);

        expect(caught).toBeDefined();
        expect(await stored("o1")).toBe(0);
        expect(realtime.notifyUpdate).not.toHaveBeenCalled();
    });

    it("refuses the write when the caught failure was a job the store refused, and stores nothing", async () => {
        attempt = () => queue.enqueue("send-receipt", { order: "o2" }, { maxAttempts: 2.5 });

        await expect(create("o2")).rejects.toEqual(refusedAsAborted);

        expect(caught).toBeDefined();
        expect(await stored("o2")).toBe(0);
        expect((await db.query<{ c: number }>("SELECT count(*)::int AS c FROM rebase.jobs")).rows[0].c).toBe(0);
    });

    it("refuses a delete the same way, and the row stays", async () => {
        await db.query("INSERT INTO orders VALUES ('o3', 'ACME Ltd')");
        attempt = (data) => data.customers.find({ where: { orders: "eq.ACME Ltd" } });

        await expect(user.delete({ row: { id: "o3", path: "orders" }, collection: orders }))
            .rejects.toEqual(refusedAsAborted);

        expect(caught).toBeDefined();
        expect(await stored("o3")).toBe(1);
    });

    it("still commits the rest when the caught failure was a nested context.data write", async () => {
        // A savepoint: the failed insert is undone on its own, and the order commits.
        attempt = (data) => data.audit.create({ note: "taken" });

        await expect(create("o4")).resolves.toMatchObject({ id: "o4" });

        expect(caught).toBeDefined();
        expect(await stored("o4")).toBe(1);
    });

    it("still commits the rest when the caught failure was a nested context.data delete", async () => {
        // The same contract as a create: a context.data write the database
        // refuses is undone on its own. The delete ran with no savepoint, so
        // the refusal aborted the whole write and the answer was a
        // TRANSACTION_ABORTED telling the developer that catching it was safe.
        attempt = (data) => data.audit.delete(1);

        await expect(create("o5")).resolves.toMatchObject({ id: "o5" });

        expect((caught as Error | undefined)?.message).toMatch(/foreign key/);
        expect(await stored("o5")).toBe(1);
        expect((await db.query<{ c: number }>("SELECT count(*)::int AS c FROM audit")).rows[0].c).toBe(1);
    });
});

describe("a failed statement the framework used to swallow", () => {
    it("answers with the database's own refusal of an inverse relation's write, not 25P02", async () => {
        // The link is written as an UPDATE on the target, which the trigger
        // refuses. Swallowed, the next statement on the transaction failed with
        // "current transaction is aborted" and the real cause was one warn line.
        const error = await user.save({ path: "owners", values: { name: "Ada", mainDoc: 1 }, collection: owners, status: "new" })
            .then(() => undefined, (e: unknown) => e);

        expect(error).toBeDefined();
        expect((error as Error).message).toMatch(/docs are frozen/);
        expect((error as Error).message).not.toMatch(/25P02|current transaction is aborted/);
        expect((await db.query<{ c: number }>("SELECT count(*)::int AS c FROM owners")).rows[0].c).toBe(0);
    });
});
