import { defineTable, col, rel } from "@rebasepro/server/schema";
import { orders } from "./orders";
import { products } from "./products";
import type { TableHookProps } from "@rebasepro/server/schema";

/** What a table hook is handed as `context`: the caller, and `context.data` as them. */
type HookContext = TableHookProps["context"];

interface ProductValues extends Record<string, unknown> {
    name: string;
    sku: string;
    price: number;
}

const getRelationId = (val: unknown): string | number | undefined => {
    if (!val) return undefined;
    if (typeof val === "object" && val !== null && "id" in val) return getRelationId(val.id);
    if (typeof val === "string" || typeof val === "number") return val;
    return undefined;
};

async function updateOrderTotals(orderId: string | number, context: HookContext) {
    const { data: items } = await context.data.collection("order_items").find({
        where: { order: ["==", orderId] }
    });

    const subtotal = items.reduce((sum: number, item) => sum + Number(item.line_total ?? 0), 0);

    const order = await context.data.collection("orders").findById(orderId);
    if (order) {
        const tax = Number(order.tax_amount ?? 0);
        const shipping = Number(order.shipping_cost ?? 0);
        const discount = Number(order.discount_amount ?? 0);
        const total = subtotal + tax + shipping - discount;

        await context.data.collection("orders").update(orderId, {
            subtotal,
            total
        });
    }
}

export const orderItems = defineTable("order_items", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        orderId: col.uuid(),
        productId: col.uuid(),
        product_name: col.text().describe("Product name at time of order (entity)"),
        sku: col.text().describe("Product SKU at time of order (entity)"),
        quantity: col.numeric().notNull().validate({ min: 1 }),
        unit_price: col.numeric().describe("Price per unit at time of order"),
        line_total: col.numeric().describe("quantity × unit_price")
    },
    relations: {
        order: rel.belongsTo(() => orders, { onDelete: "cascade" }),
        product: rel.belongsTo(() => products, { onDelete: "restrict" })
    },
    rls: "inherit",
    hooks: {
        beforeSave: async ({ values, previousValues, context }) => {
            // An update sends only the fields that changed, so the rest are
            // read from the row as it was.
            const row = { ...previousValues, ...values };
            // A callback gets the row as REST serves it: a belongsTo is its
            // foreign-key column (`productId`, `orderId`), not the relation's name.
            const productId = getRelationId(row.productId);
            // 1. Resolve and entity product info if missing
            if (productId && (!row.product_name || !row.sku || row.unit_price === undefined || row.unit_price === null)) {
                const product = await context.data.collection<ProductValues>("products").findById(productId);
                if (product) {
                    if (!row.product_name) values.product_name = product.name;
                    if (!row.sku) values.sku = product.sku;
                    if (row.unit_price === undefined || row.unit_price === null) {
                        values.unit_price = product.price;
                    }
                }
            }

            // 2. Calculate line total
            const qty = Number(row.quantity ?? 0);
            const price = Number(values.unit_price ?? row.unit_price ?? 0);
            values.line_total = qty * price;

            return values;
        },
        afterSave: async ({ values, previousValues, context }) => {
            const orderId = getRelationId(values.orderId) ?? getRelationId(previousValues?.orderId);
            if (orderId) {
                await updateOrderTotals(orderId, context);
            }
        },
        afterDelete: async ({ values: row, context }) => {
            const orderId = getRelationId(row.orderId);
            if (orderId) {
                await updateOrderTotals(orderId, context);
            }
        }
    }
});
