import { PostgresCollection } from "@rebasepro/types";
import productsCollection from "./products";

const ordersCollection: PostgresCollection = {
    name: "Orders",
    singularName: "Order",
    slug: "orders",
    table: "orders",
    icon: "ShoppingCart",
    history: true,
    properties: {
        id: {
            name: "ID",
            type: "number",
            validation: {
                required: true
            }
        },
        customer_name: {
            name: "Customer Name",
            type: "string",
            validation: {
                required: true
            }
        },
        order_date: {
            name: "Order Date",
            type: "date"
        },
        status: {
            name: "Status",
            type: "string",
            enum: [
                { id: "pending", label: "Pending", color: "orange" },
                { id: "shipped", label: "Shipped", color: "blue" },
                { id: "delivered", label: "Delivered", color: "green" },
                { id: "cancelled", label: "Cancelled", color: "red" }
            ]
        },
        products: {
            name: "Products",
            type: "relation",
            relationName: "products",
            relation: {
                relationName: "products",
                cardinality: "many",
                direction: "owning",
                target: () => productsCollection
            }
        }
    },
    relations: [
        {
            relationName: "products",
            target: () => productsCollection,
            cardinality: "many",
            direction: "owning",
        }
    ]
};

ordersCollection.securityRules = [
    {
        name: "test_policy",
        mode: "permissive",
        operation: "all",
        pgRoles: ["public"],
        using: "true"
    }
];

export default ordersCollection;
