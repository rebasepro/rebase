/**
 * A hook that writes its own collection through `context.data` runs itself
 * again. Unconditionally, that never ends: each level is one short statement,
 * so `statement_timeout` never fires, and the request held its transaction and
 * a row lock while the hook ran tens of thousands of times — long after the
 * client had given up — until the process was killed.
 *
 * Writes nested deeper than a bound are refused with `CALLBACK_RECURSION`,
 * naming the collection and the hook, and the whole write rolls back. A chain
 * that ends — a hook writing another collection, whose hook writes a third —
 * is untouched.
 *
 * A real driver over PGlite (a real Postgres), through `withAuth`, the way
 * every request door writes.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { integer, pgTable, serial, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig, DataDriver } from "@rebasepro/types";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";
import { MAX_WRITE_DEPTH } from "../src/services/write-depth";

const ordersTable = pgTable("orders", { id: serial("id").primaryKey(), title: varchar("title"), touched: integer("touched") });
const stepsTable = pgTable("steps", { id: serial("id").primaryKey(), n: integer("n") });

type Sdk = Record<string, {
    update(id: unknown, v: unknown): Promise<unknown>;
    create(v: unknown): Promise<unknown>;
}>;

let hookRuns = 0;

const orders = {
    name: "Orders", slug: "orders", table: "orders",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        title: { name: "Title", type: "string" },
        touched: { name: "Touched", type: "number" }
    },
    callbacks: {
        // The mistake: an unconditional write to its own row.
        afterSave: async ({ id, values, context }) => {
            hookRuns += 1;
            await (context.data as never as Sdk).orders.update(id, { touched: Number(values.touched ?? 0) + 1 });
        }
    }
} as unknown as CollectionConfig;

/** A chain that ends: each step creates the next until `n` reaches the limit. */
const steps = {
    name: "Steps", slug: "steps", table: "steps",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        n: { name: "N", type: "number" }
    },
    callbacks: {
        afterSave: async ({ values, status, context }) => {
            const n = Number(values.n);
            if (status === "new" && n < 5) await (context.data as never as Sdk).steps.create({ n: n + 1 });
        }
    }
} as unknown as CollectionConfig;

let db: PGlite;
let user: DataDriver;

beforeEach(async () => {
    hookRuns = 0;
    db = new PGlite();
    await db.waitReady;
    await db.exec(
        "CREATE TABLE orders (id serial PRIMARY KEY, title varchar, touched integer);" +
        "CREATE TABLE steps (id serial PRIMARY KEY, n integer);"
    );
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([orders, steps]);
    registry.registerTable(ordersTable, "orders");
    registry.registerTable(stepsTable, "steps");
    const orm = drizzle(db, { schema: { orders: ordersTable, steps: stepsTable } }) as never;
    const base = new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);
    user = await base.withAuth({ uid: "u1", roles: ["editor"] } as never);
});

afterEach(async () => {
    await db.close();
});

const count = async (table: string) =>
    (await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM ${table}`)).rows[0].c;

describe("a hook that writes its own collection", () => {
    it("is refused at a bounded depth, naming the collection and the hook, and nothing is stored", async () => {
        const error = await user.save({ path: "orders", values: { title: "loop" }, collection: orders, status: "new" })
            .then(() => undefined, (e: unknown) => e as { code?: string; statusCode?: number; message: string });

        expect(error).toMatchObject({ code: "CALLBACK_RECURSION", statusCode: 500 });
        expect(error?.message).toMatch(/afterSave/);
        expect(error?.message).toMatch(/"orders"/);
        expect(hookRuns).toBe(MAX_WRITE_DEPTH);
        expect(await count("orders")).toBe(0);
    });

    it("leaves a chain that ends alone", async () => {
        await expect(user.save({ path: "steps", values: { n: 1 }, collection: steps, status: "new" }))
            .resolves.toMatchObject({ n: 1 });
        expect(await count("steps")).toBe(5);
    });

    it("counts siblings separately: a bulk write is not a nesting", async () => {
        const rows = Array.from({ length: MAX_WRITE_DEPTH + 4 }, () => ({ n: 5 }));
        await expect(user.saveMany!({ path: "steps", rows, collection: steps }))
            .resolves.toHaveLength(rows.length);
    });
});
