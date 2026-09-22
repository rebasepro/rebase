/**
 * An enum type's name is `<table>_<column>`, and Postgres keeps the first 63
 * bytes of it.
 *
 * Two consequences the planner did not know about:
 *
 * - **A long name was never found again.** The catalogue holds the truncated
 *   name, the plan compared the full one, so every boot after the first planned
 *   `CREATE TYPE` instead of `ADD VALUE`. Postgres answered 42710, the applier
 *   read that as a peer having won the race, and a label added to the enum
 *   never reached the type — every write using it was rejected.
 * - **Two columns could derive one name.** `orders.item_status` and
 *   `orders_item.status` are both `orders_item_status`; the second was
 *   deduplicated away and its column typed with the first one's labels. The
 *   name is frozen once a database holds it, so the planner refuses rather than
 *   renaming either.
 */
import { PGlite } from "@electric-sql/pglite";
import type { CollectionConfig } from "@rebasepro/types";
import { planSchema } from "../src/schema/plan/plan-schema";
import {
    ensureCollectionTables,
    planCollectionSchemaEnsure,
    type ExistingSchema
} from "../src/schema/ensure-collection-tables";

/** `customer_subscription_billing_events_payment_processor_status_code` is 66 bytes. */
const billingEvents = (labels: string[]): CollectionConfig => ({
    slug: "customer_subscription_billing_events",
    table: "customer_subscription_billing_events",
    name: "Billing events",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        paymentProcessorStatusCode: { name: "Status code", type: "string", enum: labels }
    }
});

const TRUNCATED = "customer_subscription_billing_events_payment_processor_status_c";

const asQueryable = (db: PGlite) => ({
    query: <R,>(text: string, values?: unknown[]) =>
        db.query<R>(text, values as unknown[]) as Promise<{ rows: R[] }>
});

describe("an enum type whose derived name is longer than 63 bytes", () => {
    it("is recognised by the name the catalogue holds", () => {
        const existing: ExistingSchema = {
            tables: new Map([["public.customer_subscription_billing_events", new Set(["id", "payment_processor_status_code"])]]),
            enums: new Set([`public.${TRUNCATED}`]),
            enumValues: new Map([[`public.${TRUNCATED}`, ["pending", "settled"]]]),
            constraints: new Set()
        };
        const plan = planCollectionSchemaEnsure([billingEvents(["pending", "settled", "refunded"])], existing);
        const enumActions = plan.actions.filter(a => a.kind === "create-enum" || a.kind === "add-enum-value");
        expect(enumActions.map(a => a.kind)).toEqual(["add-enum-value"]);
        expect(enumActions[0].sql).toContain("ADD VALUE IF NOT EXISTS 'refunded'");
    });

    it("gains a label added after the first boot", async () => {
        const db = new PGlite();
        try {
            await ensureCollectionTables(asQueryable(db), [billingEvents(["pending", "settled"])]);
            const second = await ensureCollectionTables(
                asQueryable(db), [billingEvents(["pending", "settled", "refunded"])]);
            expect(second.failures).toEqual([]);

            const { rows } = await db.query<{ typname: string; labels: string[] }>(
                `SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
                 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid GROUP BY t.typname`
            );
            expect(rows).toEqual([{ typname: TRUNCATED, labels: ["pending", "settled", "refunded"] }]);
            await db.query(
                "INSERT INTO customer_subscription_billing_events (payment_processor_status_code) VALUES ('refunded')");
        } finally {
            await db.close();
        }
    }, 30_000);
});

describe("two columns whose enum types derive the same name", () => {
    const orders: CollectionConfig = {
        slug: "orders",
        table: "orders",
        name: "Orders",
        properties: {
            id: { name: "ID", type: "string", isId: "uuid" },
            itemStatus: { name: "Item status", type: "string", enum: ["pending", "shipped"] }
        }
    };
    const orderItems: CollectionConfig = {
        slug: "orders_item",
        table: "orders_item",
        name: "Order items",
        properties: {
            id: { name: "ID", type: "string", isId: "uuid" },
            status: { name: "Status", type: "string", enum: ["in_stock", "backordered"] }
        }
    };

    it("are refused, naming both properties and the type", () => {
        expect(() => planSchema([orders, orderItems])).toThrow(/"public"\."orders_item_status"/);
        expect(() => planSchema([orders, orderItems])).toThrow(/"itemStatus" of collection "orders"/);
        expect(() => planSchema([orders, orderItems])).toThrow(/"status" of collection "orders_item"/);
    });

    it("are refused when only the truncated names coincide", () => {
        const long = (slug: string, column: string): CollectionConfig => ({
            slug,
            table: slug,
            name: slug,
            properties: {
                id: { name: "ID", type: "string", isId: "uuid" },
                [column]: { name: column, type: "string", enum: ["a", "b"] }
            }
        });
        // Two different tables and columns, 66 bytes each, sharing their first 63.
        const first = long("customer_subscription_billing_events", "payment_processor_status_code");
        const other = long("customer_subscription_billing_events_payment", "processor_status_count");
        expect(() => planSchema([first])).not.toThrow();
        expect(() => planSchema([first, other])).toThrow(new RegExp(`"public"\\."${TRUNCATED}"`));
    });

    it("are not a collision when they are the same column, declared twice", () => {
        // Two collections over one table — a filtered view, say — share the
        // column and so share its type.
        const drafts: CollectionConfig = { ...orders, slug: "draft_orders", name: "Draft orders" };
        const plan = planSchema([orders, drafts]);
        expect(plan.enums.map(e => e.qualified)).toEqual(["public.orders_item_status"]);
    });

    it("are not a collision in two different schemas", () => {
        const archived: CollectionConfig = { ...orderItems, slug: "archived_items", schema: "archive" };
        const plan = planSchema([orders, archived]);
        expect(plan.enums.map(e => e.qualified).sort())
            .toEqual(["archive.orders_item_status", "public.orders_item_status"]);
    });
});
