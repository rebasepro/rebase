import { defineTable, col, rel } from "@rebasepro/server/schema";
import { orderItems } from "./order_items";
import { customers } from "./customers";
import type { TableHookProps } from "@rebasepro/server/schema";

/** What a table hook is handed as `context`: the caller, and `context.data` as them. */
type HookContext = TableHookProps["context"];

const getRelationId = (val: unknown): string | number | undefined => {
    if (!val) return undefined;
    if (typeof val === "object" && val !== null && "id" in val) return getRelationId(val.id);
    if (typeof val === "string" || typeof val === "number") return val;
    return undefined;
};

async function updateCustomerMetrics(customerId: string | number, context: HookContext) {
    const { data: customerOrders } = await context.data.collection("orders").find({
        where: {
            customer: ["==", customerId],
            status: ["!=", "cancelled"] // Ignore cancelled orders
        }
    });

    const totalOrders = customerOrders.length;
    const lifetimeValue = customerOrders.reduce((sum: number, order) => {
        // Sum only paid or delivered orders
        if (order.payment_status === "paid" || order.status === "delivered") {
            return sum + Number(order.total ?? 0);
        }
        return sum;
    }, 0);

    await context.data.collection("customers").update(customerId, {
        total_orders: totalOrders,
        lifetime_value: lifetimeValue,
        is_vip: lifetimeValue >= 1000 // VIP threshold
    });
}

export const orders = defineTable("orders", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        order_number: col.text().notNull().unique().describe("Human-readable order identifier (e.g. ORD-2025-0042)"),
        customerId: col.uuid().notNull(),
        status: col.enum(["pending", "confirmed", "processing", "shipped", "delivered", "cancelled", "refunded"]).notNull().default("pending"),
        payment_status: col.enum(["unpaid", "paid", "partially_refunded", "refunded"]).notNull().default("unpaid"),
        subtotal: col.numeric().describe("Sum of all line items before tax and shipping"),
        tax_amount: col.numeric().default(0).describe("Tax amount"),
        shipping_cost: col.numeric().default(0).describe("Shipping cost"),
        discount_amount: col.numeric().default(0).describe("Total discount applied"),
        total: col.numeric().describe("Final order total (subtotal + tax + shipping - discount)"),
        currency: col.enum(["USD", "EUR", "GBP", "CAD", "AUD"]).default("USD"),
        shipping_address: col.text().describe("Delivery address for this order"),
        tracking_number: col.text().describe("Shipping carrier tracking number"),
        notes: col.text().describe("Internal notes (not visible to customer)"),
        order_date: col.timestamptz().notNull(),
        shipped_date: col.timestamptz(),
        delivered_date: col.timestamptz(),
        created_at: col.timestamptz().onCreateNow(),
        updated_at: col.timestamptz().onUpdateNow(),
        __order: col.text().describe("Fractional index maintained by the Kanban board")
    },
    relations: {
        order_items: rel.hasMany(() => orderItems),
        customer: rel.belongsTo(() => customers)
    },
    rls: "inherit",
    history: true,
    hooks: {
        beforeSave: ({ values, previousValues }) => {
            // Ensure total is kept in sync if tax, shipping or discount changes.
            // An update sends only the fields that changed, so the rest are
            // read from the row as it was.
            const row = { ...previousValues, ...values };
            const subtotal = Number(row.subtotal ?? 0);
            const tax = Number(row.tax_amount ?? 0);
            const shipping = Number(row.shipping_cost ?? 0);
            const discount = Number(row.discount_amount ?? 0);
            values.total = subtotal + tax + shipping - discount;
            return values;
        },
        afterSave: async ({ values, previousValues, context }) => {
            // A callback gets the row as REST serves it: a belongsTo is its
            // foreign-key column, `customerId`, not the relation's name.
            const customerId = getRelationId(values.customerId) ?? getRelationId(previousValues?.customerId);
            if (customerId) {
                await updateCustomerMetrics(customerId, context);
            }
        },
        afterDelete: async ({ values: row, context }) => {
            const customerId = getRelationId(row.customerId);
            if (customerId) {
                await updateCustomerMetrics(customerId, context);
            }
        }
    }
});
