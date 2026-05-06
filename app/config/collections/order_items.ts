import { PostgresCollection } from "@rebasepro/types";
import ordersCollection from "./orders";
import productsCollection from "./products";

const orderItemsCollection: PostgresCollection = {
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
            type: "number",
            isId: "increment"
        },
        order: {
            name: "Order",
            type: "relation",
            target: () => ordersCollection,
            cardinality: "one",
            direction: "owning"
        },
        product: {
            name: "Product",
            type: "relation",
            target: () => productsCollection,
            cardinality: "one",
            direction: "owning"
        },
        product_name: {
            name: "Product Name",
            type: "string",
            validation: {
                required: true
            },
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
            validation: {
                required: true,
                min: 0
            },
            description: "Price per unit at time of order"
        },
        line_total: {
            name: "Line Total",
            type: "number",
            readOnly: true,
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
    ]
};

orderItemsCollection.securityRules = [
    {
        name: "test_policy",
        mode: "permissive",
        operation: "all",
        pgRoles: ["public"],
        using: "true"
    }
];

export default orderItemsCollection;
