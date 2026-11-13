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
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";
import { planSchema } from "../src/schema/plan/plan-schema";
import {
    ensureTables,
    planTableSchemaEnsure,
    type ExistingSchema
} from "../src/schema/ensure-tables";
import { compileSet, planCollections } from "./helpers/plan-tables";

/** `customer_subscription_billing_events_payment_processor_status_code` is 66 bytes. */
const billingEvents = (labels: string[]): LegacyCollectionConfig => ({
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
        const plan = planTableSchemaEnsure(compileSet([billingEvents(["pending", "settled", "refunded"])]), existing);
        const enumActions = plan.actions.filter(a => a.kind === "create-enum" || a.kind === "add-enum-value");
        expect(enumActions.map(a => a.kind)).toEqual(["add-enum-value"]);
        expect(enumActions[0].sql).toContain("ADD VALUE IF NOT EXISTS 'refunded'");
    });

    it("gains a label added after the first boot", async () => {
        const db = new PGlite();
        try {
            await ensureTables(asQueryable(db), compileSet([billingEvents(["pending", "settled"])]));
            const second = await ensureTables(
                asQueryable(db), compileSet([billingEvents(["pending", "settled", "refunded"])]));
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
    const orders: LegacyCollectionConfig = {
        slug: "orders",
        table: "orders",
        name: "Orders",
        properties: {
            id: { name: "ID", type: "string", isId: "uuid" },
            itemStatus: { name: "Item status", type: "string", enum: ["pending", "shipped"] }
        }
    };
    const orderItems: LegacyCollectionConfig = {
        slug: "orders_item",
        table: "orders_item",
        name: "Order items",
        properties: {
            id: { name: "ID", type: "string", isId: "uuid" },
            status: { name: "Status", type: "string", enum: ["in_stock", "backordered"] }
        }
    };

    it("are refused, naming both properties and the type", () => {
        expect(() => planCollections([orders, orderItems])).toThrow(/"public"\."orders_item_status"/);
        expect(() => planCollections([orders, orderItems])).toThrow(/enum type of "orders\.itemStatus"/);
        expect(() => planCollections([orders, orderItems])).toThrow(/orders_item\.status: the enum type/);
    });

    it("are refused when only the truncated names coincide", () => {
        const long = (slug: string, column: string): LegacyCollectionConfig => ({
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
        expect(() => planCollections([first])).not.toThrow();
        expect(() => planCollections([first, other])).toThrow(new RegExp(`"public"\\."${TRUNCATED}"`));
    });

    // ("Two collections over one table share its enum type" was a case here.
    // The table model has one definition per table — `compileTables` refuses a
    // second one — so there is no second declaration left to share with.)

    it("are not a collision in two different schemas", () => {
        const archived: LegacyCollectionConfig = { ...orderItems, slug: "archived_items", schema: "archive" };
        const plan = planCollections([orders, archived]);
        expect(plan.enums.map(e => e.qualified).sort())
            .toEqual(["archive.orders_item_status", "public.orders_item_status"]);
    });
});
