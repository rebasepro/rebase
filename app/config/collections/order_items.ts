import { defineCollection, EntityCallbackContext } from "@rebasepro/common";
// Mutually recursive by design; the reference is only dereferenced inside the
// `target: () =>` thunk below, so module init order never matters.
// fallow-ignore-next-line circular-dependency
import ordersCollection from "./orders";
// fallow-ignore-next-line circular-dependency
import productsCollection from "./products";
import type { PostgresCollectionConfig } from "@rebasepro/types";

interface ProductValues extends Record<string, unknown> {
    name: string;
    sku: string;
    price: number;
}

// Helper function to extract ID from relation value (which can be primitive ID or expanded object)
const getRelationId = (val: unknown): string | number | undefined => {
    if (!val) return undefined;
    if (typeof val === "object" && val !== null && "id" in val) return (val as { id: string | number }).id;
    if (typeof val === "string" || typeof val === "number") return val;
    return undefined;
};

const orderItemsCollection: PostgresCollectionConfig = {
    name: "Order Items",
    singularName: "Order Item",
    slug: "order_items",
    table: "order_items",
    properties: {
        id: {
            name: "ID",
            type: "string",
            isId: "uuid"
        },
        order: {
            name: "Order",
            type: "relation",
            relation: {
                kind: "belongsTo",
                target: () => ordersCollection,
                onDelete: "cascade",
            }
        },
        product: {
            name: "Product",
            type: "relation",
            relation: {
                kind: "belongsTo",
                target: () => productsCollection,
                onDelete: "restrict",
            }
        },
        product_name: {
            name: "Product Name",
            type: "string",
            description: "Product name at time of order (entity)"
        },
        sku: {
            name: "SKU",
            type: "string",
            description: "Product SKU at time of order (entity)"
        },
        quantity: {
            name: "Quantity",
            type: "number",
            validation: {
                required: true,
                min: 1
            }
        },
        unit_price: {
            name: "Unit Price",
            type: "number",
            description: "Price per unit at time of order"
        },
        line_total: {
            name: "Line Total",
            type: "number",
            admin: { readOnly: true },
            description: "quantity × unit_price"
        }
    },
    callbacks: {
        beforeSave: async ({ values, context }) => {
            const productId = getRelationId(values.product);
            // 1. Resolve and entity product info if missing
            if (productId && (!values.product_name || !values.sku || values.unit_price === undefined)) {
                const product = await context.data.collection<ProductValues>("products").findById(productId);
                if (product) {
                    values.product_name = values.product_name || product.name;
                    values.sku = values.sku || product.sku;
                    if (values.unit_price === undefined || values.unit_price === null) {
                        values.unit_price = product.price;
                    }
                }
            }

            // 2. Calculate line total
            const qty = Number(values.quantity ?? 0);
            const price = Number(values.unit_price ?? 0);
            values.line_total = qty * price;

            return values;
        },
        afterSave: async ({ values, context }) => {
            const orderId = getRelationId(values.order);
            if (orderId) {
                await updateOrderTotals(orderId, context);
            }
        },
        afterDelete: async ({ row, context }) => {
            const orderId = getRelationId(row.order);
            if (orderId) {
                await updateOrderTotals(orderId, context);
            }
        }
    },
    admin: {
        icon: "ReceiptText",
        group: "E-Commerce",
        hideFromNavigation: true,
        form: {
            sections: [
                { key: "item", properties: ["order", "product", "product_name", "sku"] },
                {
                    key: "amounts",
                    title: "Amounts",
                    properties: ["quantity", "unit_price", "line_total"],
                    // `line_total` is `quantity × unit_price`, and a line item is
                    // read to check that arithmetic. Stacked as a receipt it can
                    // be checked at a glance; on the grid it is three numbers.
                    readVariant: "summary"
                }
            ]
        },
        propertiesOrder: [
            "product",
            "product_name",
            "sku",
            "quantity",
            "unit_price",
            "line_total"
        ]
    }
};

// Helper function to recalculate the parent order subtotal & total
async function updateOrderTotals(orderId: string | number, context: EntityCallbackContext) {
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

export default orderItemsCollection;
