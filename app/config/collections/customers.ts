import { PostgresCollection } from "@rebasepro/types";
import ordersCollection from "./orders";

const customersCollection: PostgresCollection = {
    name: "Customers",
    singularName: "Customer",
    slug: "customers",
    table: "customers",
    icon: "Users",
    group: "E-Commerce",
    history: true,
    defaultEntityAction: "view",
    properties: {
        id: {
            name: "ID",
            type: "string",
            isId: "uuid"
        },
        first_name: {
            name: "First Name",
            type: "string",
            validation: {
                required: true
            }
        },
        last_name: {
            name: "Last Name",
            type: "string",
            validation: {
                required: true
            }
        },
        email: {
            name: "Email",
            type: "string",
            validation: {
                required: true,
                unique: true
            }
        },
        phone: {
            name: "Phone",
            type: "string"
        },
        avatar: {
            name: "Avatar",
            type: "string",
            storage: {
                storagePath: "customer_avatars/"
            },
            description: "Customer profile picture"
        },
        company: {
            name: "Company",
            type: "string"
        },
        is_vip: {
            name: "VIP",
            type: "boolean",
            description: "Whether this customer has VIP status"
        },
        lifetime_value: {
            name: "Lifetime Value",
            type: "number",
            description: "Total amount spent across all orders"
        },
        total_orders: {
            name: "Total Orders",
            type: "number",
            description: "Number of orders placed"
        },
        shipping_address: {
            name: "Shipping Address",
            type: "string",
            ui: { multiline: true },
        },
        billing_address: {
            name: "Billing Address",
            type: "string",
            ui: { multiline: true },
        },
        notes: {
            name: "Notes",
            type: "string",
            ui: { multiline: true },
            description: "Internal notes about this customer"
        },
        created_at: {
            name: "Created at",
            type: "date",
            autoValue: "on_create",
            ui: { readOnly: true, hideFromCollection: true },
        },
        updated_at: {
            name: "Updated at",
            type: "date",
            autoValue: "on_update",
            ui: { readOnly: true, hideFromCollection: true },
        }
    },
    propertiesOrder: [
        "first_name",
        "last_name",
        "email",
        "phone",
        "avatar",
        "company",
        "is_vip",
        "lifetime_value",
        "total_orders",
        "shipping_address",
        "billing_address",
        "notes",
        "created_at",
        "updated_at"
    ],
    relations: [
        {
            relationName: "orders",
            target: () => ordersCollection,
            cardinality: "many",
            direction: "inverse",
            inverseRelationName: "customer"
        }
    ]
};

customersCollection.securityRules = [
    {
        name: "test_policy",
        mode: "permissive",
        operation: "all",
        pgRoles: ["authenticated"],
        using: "true"
    }
];

export default customersCollection;
