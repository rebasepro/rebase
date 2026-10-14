/**
 * What a new record opened under `parent/{id}/{relation}` takes from its
 * address.
 *
 * A transaction created from a customer's Transactions tab opened with its
 * required Customer field empty, asking the user to pick the customer they had
 * just come from — although the server stamps that link on the create anyway.
 */
import type { CollectionConfig } from "@rebasepro/types";
import { EntityRelation } from "@rebasepro/types";
import { getParentLinkValues } from "../../src/form/form_utils";

const id = {
    type: "string",
    isId: true
};

const customers = {
    slug: "customers",
    table: "customers",
    name: "Customers",
    properties: {
        id,
        name: { type: "string" }
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "transactions",
            target: () => transactions,
            foreignKeyOnTarget: "customer_id"
        },
        {
            kind: "manyToMany",
            relationName: "tags",
            target: () => tags
        }
    ]
} as unknown as CollectionConfig;

const transactions = {
    slug: "transactions",
    table: "transactions",
    name: "Transactions",
    properties: {
        id,
        amount: { type: "number" },
        customer: {
            type: "relation",
            validation: { required: true },
            relation: {
                kind: "belongsTo",
                target: () => customers
            }
        }
    }
} as unknown as CollectionConfig;

const tags = {
    slug: "tags",
    table: "tags",
    name: "Tags",
    properties: {
        id,
        label: { type: "string" }
    }
} as unknown as CollectionConfig;

/** The two calls the helper makes of the admin's collection registry. */
function registryOf(collections: Record<string, CollectionConfig>, parentIds: Record<string, string[]>) {
    return {
        getCollection: (path: string) => collections[path],
        getParentEntityIds: (path: string) => parentIds[path] ?? []
    };
}

const registry = registryOf(
    {
        customers,
        transactions
    },
    {
        "customers/c-1/transactions": ["c-1"],
        "customers/c-1/tags": ["c-1"]
    }
);

describe("the link a new record takes from its address", () => {

    it("points a child created under its parent back at that parent", () => {
        const values = getParentLinkValues(registry, "customers/c-1/transactions", transactions);
        expect(Object.keys(values)).toEqual(["customer"]);
        expect(values.customer).toBeInstanceOf(EntityRelation);
        expect(values.customer.id).toBe("c-1");
        expect(values.customer.path).toBe("customers");
    });

    it("finds the link through the default foreign key too", () => {
        const orders = {
            slug: "orders",
            table: "orders",
            name: "Orders",
            properties: {
                id,
                customer: {
                    type: "relation",
                    relation: {
                        kind: "belongsTo",
                        target: () => shoppers
                    }
                }
            }
        } as unknown as CollectionConfig;
        // No `foreignKeyOnTarget` and no `localKey`: both sides default to
        // `customer_id`, as in the demo app's customers and orders.
        const shoppers = {
            slug: "customers",
            table: "customers",
            name: "Customers",
            properties: { id },
            relations: [{
                kind: "hasMany",
                relationName: "orders",
                target: () => orders
            }]
        } as unknown as CollectionConfig;
        const values = getParentLinkValues(
            registryOf({ customers: shoppers }, { "customers/7/orders": ["7"] }),
            "customers/7/orders",
            orders
        );
        expect(values.customer?.id).toBe("7");
    });

    it("leaves a root collection alone", () => {
        expect(getParentLinkValues(registry, "transactions", transactions)).toEqual({});
    });

    it("leaves a many-to-many alone: that link is a junction row, not a property", () => {
        expect(getParentLinkValues(registry, "customers/c-1/tags", tags)).toEqual({});
    });

    it("leaves a link keyed on another column of the parent alone", () => {
        const accounts = {
            slug: "accounts",
            table: "accounts",
            name: "Accounts",
            properties: {
                id,
                code: { type: "string" }
            },
            relations: [{
                kind: "hasMany",
                relationName: "invoices",
                target: () => invoices,
                foreignKeyOnTarget: "account_code",
                sourceKey: "code"
            }]
        } as unknown as CollectionConfig;
        const invoices = {
            slug: "invoices",
            table: "invoices",
            name: "Invoices",
            properties: {
                id,
                account: {
                    type: "relation",
                    relation: {
                        kind: "belongsTo",
                        target: () => accounts,
                        localKey: "account_code"
                    }
                }
            }
        } as unknown as CollectionConfig;
        // The address carries the account's id, and the link is its code.
        expect(getParentLinkValues(
            registryOf({ accounts }, { "accounts/a-1/invoices": ["a-1"] }),
            "accounts/a-1/invoices",
            invoices
        )).toEqual({});
    });

    it("leaves a child with no belongsTo on the foreign key alone", () => {
        const loose = {
            ...transactions,
            properties: {
                id,
                amount: { type: "number" }
            }
        } as unknown as CollectionConfig;
        expect(getParentLinkValues(registry, "customers/c-1/transactions", loose)).toEqual({});
    });
});
