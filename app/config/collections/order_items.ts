import { defineCollection } from "@rebasepro/common";
import ordersCollection from "./orders";
import productsCollection from "./products";

interface ProductValues extends Record<string, unknown> {
    name: string;
    sku: string;
    price: number;
}

// Helper function to extract ID from relation value (which can be primitive ID or expanded object)
const getRelationId = (val: any): string | number | undefined => {
    if (!val) return undefined;
    if (typeof val === "object" && "id" in val) return val.id;
    if (typeof val === "string" || typeof val === "number") return val;
    return undefined;
};

const orderItemsCollection = defineCollection({
    name: "Order Items",
    singularName: "Order Item",
    slug: "order_items",
    table: "order_items",
    icon: "ReceiptText",
    group: "E-Commerce",
    hideFromNavigation: true,
    properties: {
        id: {
            name: "ID",
            type: "string",
            isId: "uuid"
        },
        order: {
            name: "Order",
            type: "relation",
            target: () => ordersCollection,
            cardinality: "one",
            direction: "owning",
            onDelete: "cascade"
        },
        product: {
            name: "Product",
            type: "relation",
            target: () => productsCollection,
            cardinality: "one",
            direction: "owning",
            onDelete: "restrict"
        },
        product_name: {
            name: "Product Name",
            type: "string",
            description: "Product name at time of order (snapshot)"
        },
        sku: {
            name: "SKU",
            type: "string",
            description: "Product SKU at time of order (snapshot)"
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
            ui: { readOnly: true },
            description: "quantity × unit_price"
        }
    },
    propertiesOrder: [
        "product",
        "product_name",
        "sku",
        "quantity",
        "unit_price",
        "line_total"
    ],
    callbacks: {
        beforeSave: async ({ values, context }) => {
            const productId = getRelationId(values.product);
            // 1. Resolve and snapshot product info if missing
            if (productId && (!values.product_name || !values.sku || values.unit_price === undefined)) {
                const product = await context.data.collection<ProductValues>("products").findById(productId);
                if (product) {
                    values.product_name = values.product_name || product.values.name;
                    values.sku = values.sku || product.values.sku;
                    if (values.unit_price === undefined || values.unit_price === null) {
                        values.unit_price = product.values.price;
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
        afterDelete: async ({ entity, context }) => {
            const orderId = getRelationId(entity.values.order);
            if (orderId) {
                await updateOrderTotals(orderId, context);
            }
        }
    }
});

// Helper function to recalculate the parent order subtotal & total
async function updateOrderTotals(orderId: string | number, context: any) {
    const { data: items } = await context.data.collection("order_items").find({
        where: { order: ["==", orderId] }
    });

    const subtotal = items.reduce((sum: number, item: any) => sum + Number(item.values.line_total ?? 0), 0);

    const order = await context.data.collection("orders").findById(orderId);
    if (order) {
        const tax = Number(order.values.tax_amount ?? 0);
        const shipping = Number(order.values.shipping_cost ?? 0);
        const discount = Number(order.values.discount_amount ?? 0);
        const total = subtotal + tax + shipping - discount;

        await context.data.collection("orders").update(orderId, {
            subtotal,
            total
        });
    }
}

orderItemsCollection.securityRules = [
    {
        name: "test_policy",
        mode: "permissive",
        operation: "all",
        pgRoles: ["authenticated"],
        using: "true"
    }
];

export default orderItemsCollection;
