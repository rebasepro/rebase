// Mutually recursive by design; the reference is only dereferenced inside the
// `target: () =>` thunk below, so module init order never matters.
// fallow-ignore-next-line circular-dependency
import ordersCollection from "./orders";
import type { PostgresCollectionConfig } from "@rebasepro/types";

const customersCollection: PostgresCollectionConfig = {
    name: "Customers",
    singularName: "Customer",
    slug: "customers",
    table: "customers",
    history: true,
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
            admin: { readOnly: true },
            description: "Whether this customer has VIP status (spent >= $1000)"
        },
        lifetime_value: {
            name: "Lifetime Value",
            type: "number",
            admin: { readOnly: true },
            description: "Total amount spent across all orders"
        },
        total_orders: {
            name: "Total Orders",
            type: "number",
            admin: { readOnly: true },
            description: "Number of orders placed"
        },
        shipping_address: {
            name: "Shipping Address",
            type: "string",
            admin: { multiline: true }
        },
        billing_address: {
            name: "Billing Address",
            type: "string",
            admin: { multiline: true }
        },
        notes: {
            name: "Notes",
            type: "string",
            admin: { multiline: true },
            description: "Internal notes about this customer"
        },
        created_at: {
            name: "Created at",
            type: "date",
            autoValue: "on_create",
            admin: {
                readOnly: true,
                hideFromCollection: true
            }
        },
        updated_at: {
            name: "Updated at",
            type: "date",
            autoValue: "on_update",
            admin: {
                readOnly: true,
                hideFromCollection: true
            }
        }
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "orders",
            target: () => ordersCollection,
            }
    ],
    admin: {
        icon: "Users",
        group: "E-Commerce",
        defaultEntityAction: "view",
        // The three derived stats are read-only and rarely the reason you opened
        // the record, so they sit in the rail rather than between the person's
        // phone number and their address.
        form: {
            sidebar: ["is_vip", "lifetime_value", "total_orders"],
            sections: [
                { key: "person", properties: ["avatar", "first_name", "last_name", "email", "phone", "company"] },
                {
                    key: "addresses",
                    title: "Addresses",
                    properties: ["shipping_address", "billing_address"]
                },
                {
                    key: "internal",
                    title: "Internal",
                    properties: ["notes"],
                    collapsed: true
                }
            ]
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
        ]
    }
};


export default customersCollection;
