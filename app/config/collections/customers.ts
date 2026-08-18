// Mutually recursive by design; the reference is only dereferenced inside the
// `target: () =>` thunk below, so module init order never matters.
// fallow-ignore-next-line circular-dependency
import ordersCollection from "./orders";
import type { PostgresCollectionConfig } from "@rebasepro/types";
import { fullName, joinParts, money } from "../display";

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
        // A person is called by their whole name, and this collection keeps the
        // two halves in separate columns — so the derived title, which can only
        // ever name one property, called every customer by their first name
        // alone. That is the case `display` resolvers exist for.
        display: {
            title: ({ entity }) => fullName(entity.values),
            subtitle: ({ entity }) => joinParts(entity.values.company, entity.values.email),
            image: "avatar",
            date: "created_at",
            // Two derived stats, said once: whether they are worth attention and
            // how much they have spent. Both are read-only columns maintained by
            // the order callbacks, which is why neither is worth a form field.
            tags: ({ entity }) => [
                entity.values.is_vip ? "VIP" : undefined,
                money(entity.values.lifetime_value)
            ].filter((tag): tag is string => Boolean(tag))
        },
        // What a customer looks like when *another* record points at it — the
        // Customer cell on an order, the picker. Without it the card repeated
        // itself: "Robert Lopez" over "Lopez", because the second line falls to
        // the next ranked property and that is the surname.
        previewProperties: ["company", "email"],
        // Two keys, in order of significance: the VIPs first, and inside each
        // group the biggest spenders first. The row id breaks the last tie, so
        // paging over this order neither repeats nor skips a customer.
        sort: [["is_vip", "desc"], ["lifetime_value", "desc"]],
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
