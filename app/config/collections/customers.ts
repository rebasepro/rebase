import { PostgresCollection } from "@rebasepro/types";
import ordersCollection from "./orders";

const customersCollection: PostgresCollection = {
    name: "Customers",
    singularName: "Customer",
    slug: "customers",
    table: "customers",
    icon: "People",
    group: "E-Commerce",
    history: true,
    openEntityMode: "split",
    properties: {
        id: {
            name: "ID",
            type: "number",
            isId: "increment"
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
        company: {
            name: "Company",
            type: "string"
        },
        shipping_address: {
            name: "Shipping Address",
            type: "string",
            multiline: true
        },
        billing_address: {
            name: "Billing Address",
            type: "string",
            multiline: true
        },
        notes: {
            name: "Notes",
            type: "string",
            multiline: true,
            description: "Internal notes about this customer"
        },
        created_at: {
            name: "Created at",
            type: "date",
            autoValue: "on_create",
            readOnly: true,
            hideFromCollection: true
        },
        updated_at: {
            name: "Updated at",
            type: "date",
            autoValue: "on_update",
            readOnly: true,
            hideFromCollection: true
        }
    },
    propertiesOrder: [
        "first_name",
        "last_name",
        "email",
        "phone",
        "company",
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
        pgRoles: ["public"],
        using: "true"
    }
];

export default customersCollection;
