/**
 * What a `beforeSave` returns is what gets saved, key by key.
 *
 * The driver folded a hook's result into the values with `mergeDeep`, which
 * merges arrays of objects element by element and keeps every element past the
 * end of the shorter one. So a hook that dropped a line item —
 * `{ ...values, lineItems: values.lineItems.filter(...) }` — had the dropped
 * one merged back in, and the order was stored with a line duplicated. A key
 * removed from a nested map came back the same way.
 *
 * A key the hook returns now replaces the value wholesale; a key it leaves out
 * keeps the value it was given. A real driver over PGlite, saving once through
 * each kind of hook.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { jsonb, pgTable, serial, varchar } from "drizzle-orm/pg-core";
import type { CollectionCallbacks, CollectionConfig } from "@rebasepro/types";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";

const ordersTable = pgTable("orders", {
    id: serial("id").primaryKey(),
    customer: varchar("customer"),
    lineItems: jsonb("line_items"),
    meta: jsonb("meta")
});

type LineItem = { sku: string; qty: number };

const lines = (): LineItem[] => [
    { sku: "a", qty: 1 },
    { sku: "b", qty: 0 },
    { sku: "c", qty: 2 }
];

/** Drop the empty lines, and the draft note — the shape a real hook has. */
const collectionHook: CollectionCallbacks = {
    beforeSave: ({ values }) => ({
        ...values,
        lineItems: (values.lineItems as LineItem[]).filter(line => line.qty > 0),
        meta: { channel: (values.meta as Record<string, unknown>).channel }
    })
};

function orders(options: { callbacks?: CollectionCallbacks; propertyHook?: boolean } = {}): CollectionConfig {
    return {
        name: "Orders",
        slug: "orders",
        table: "orders",
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            customer: { name: "Customer", type: "string" },
            lineItems: {
                name: "Line items",
                type: "array",
                columnName: "line_items",
                of: {
                    type: "map",
                    properties: { sku: { name: "SKU", type: "string" }, qty: { name: "Qty", type: "number" } }
                },
                ...(options.propertyHook && {
                    callbacks: {
                        beforeSave: ({ value }: { value: unknown }) => (value as LineItem[]).filter(line => line.qty > 0)
                    }
                })
            },
            meta: { name: "Meta", type: "map", properties: { channel: { name: "Channel", type: "string" }, draftNote: { name: "Note", type: "string" } } }
        },
        ...(options.callbacks && { callbacks: options.callbacks })
    } as CollectionConfig;
}

let db: PGlite;

function driverOver(pglite: PGlite, collection: CollectionConfig): PostgresBackendDriver {
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([collection]);
    registry.registerTable(ordersTable, "orders");
    const orm = drizzle(pglite, { schema: { orders: ordersTable } }) as never;
    return new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);
}

async function stored(): Promise<{ line_items: LineItem[]; meta: Record<string, unknown> }> {
    const result = await db.query<{ line_items: LineItem[]; meta: Record<string, unknown> }>(
        "SELECT line_items, meta FROM orders"
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0];
}

beforeEach(async () => {
    db = new PGlite();
    await db.waitReady;
    await db.exec("CREATE TABLE orders (id serial PRIMARY KEY, customer varchar, line_items jsonb, meta jsonb);");
});

afterEach(async () => {
    await db.close();
});

describe("a beforeSave's result", () => {
    it("from a collection hook: a filtered array and a narrowed map are saved as returned", async () => {
        const collection = orders({ callbacks: collectionHook });
        await driverOver(db, collection).save({
            path: "orders",
            status: "new",
            collection,
            values: { customer: "ada", lineItems: lines(), meta: { channel: "web", draftNote: "tbd" } }
        });

        const row = await stored();
        expect(row.line_items.map(line => line.sku)).toEqual(["a", "c"]);
        expect(row.meta).toEqual({ channel: "web" });
    });

    it("from a property hook: the filtered array is saved as returned", async () => {
        const collection = orders({ propertyHook: true });
        await driverOver(db, collection).save({
            path: "orders",
            status: "new",
            collection,
            values: { customer: "ada", lineItems: lines(), meta: { channel: "web" } }
        });

        expect((await stored()).line_items.map(line => line.sku)).toEqual(["a", "c"]);
    });

    it("a key the hook leaves out keeps the value it was given", async () => {
        const collection = orders({ callbacks: { beforeSave: () => ({ customer: "grace" }) } });
        await driverOver(db, collection).save({
            path: "orders",
            status: "new",
            collection,
            values: { customer: "ada", lineItems: lines(), meta: { channel: "web" } }
        });

        const result = await db.query<{ customer: string; line_items: LineItem[] }>("SELECT customer, line_items FROM orders");
        expect(result.rows[0].customer).toBe("grace");
        expect(result.rows[0].line_items.map(line => line.sku)).toEqual(["a", "b", "c"]);
    });
});
