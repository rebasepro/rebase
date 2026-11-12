// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import ordersCollection from "./orders";
import productsCollection from "./products";

// Introspected as an owned-child: belongs to orders (the leading column of a primary key made only of foreign keys) and nothing else references it.

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "quantity" is smallint, which no `columnType` names; it is declared integer, so a push widens it (every value survives).

const orderDetailsCollection = defineCollection({
    name: "Order Details",
    singularName: "Order Detail",
    slug: "order_details",
    table: "order_details",
    properties: {
        orderId: {
            name: "Order Id",
            columnName: "order_id",
            type: "number",
            // Part of composite primary key (order_id, product_id)
            isId: "manual",
        },
        productId: {
            name: "Product Id",
            columnName: "product_id",
            type: "number",
            // Part of composite primary key (order_id, product_id)
            isId: "manual",
        },
        order: {
            name: "Order",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: order_id -> orders(order_id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => ordersCollection,
                localKey: "order_id",
                onDelete: "no action"
            }
        },
        unitPrice: {
            name: "Unit Price",
            columnName: "unit_price",
            type: "number",
            columnType: "real",
            validation: {
                required: true
            },
        },
        quantity: {
            name: "Quantity",
            columnName: "quantity",
            type: "number",
            columnType: "integer",
            validation: {
                required: true
            },
        },
        discount: {
            name: "Discount",
            columnName: "discount",
            type: "number",
            columnType: "real",
            validation: {
                required: true
            },
        },
        product: {
            name: "Product",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: product_id -> products(product_id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => productsCollection,
                localKey: "product_id",
                onDelete: "no action"
            }
        },
    },
    admin: {
        icon: "ShoppingCart",
        hideFromNavigation: true,
        listProperties: [
            "orderId",
            "productId",
            "order",
            "unitPrice",
            "quantity",
            "discount"
        ],
        propertiesOrder: [
            "orderId",
            "productId",
            "order",
            "unitPrice",
            "quantity",
            "discount",
            "product"
        ]
    }
});

export default orderDetailsCollection;
