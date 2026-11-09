/**
 * What a new record opened under `parent/{id}/{relation}` takes from its
 * address.
 *
 * A transaction created from a customer's Transactions tab opened with its
 * required Customer field empty, asking the user to pick the customer they had
 * just come from — although the server stamps that link on the create anyway.
 */
import type { CollectionConfig, StringProperty } from "@rebasepro/types";
import { EntityRelation } from "@rebasepro/types";
import { getParentLinkValues } from "../../src/form/form_utils";

const id: StringProperty = {
    type: "string",
    isId: true
};

const customers: CollectionConfig = {
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
};

const transactions: CollectionConfig = {
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
};

const tags: CollectionConfig = {
    slug: "tags",
    table: "tags",
    name: "Tags",
    properties: {
        id,
        label: { type: "string" }
    }
};

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
        const orders: CollectionConfig = {
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
        };
        // No `foreignKeyOnTarget` and no `localKey`: both sides default to
        // `customer_id`, as in the demo app's customers and orders.
        const shoppers: CollectionConfig = {
            slug: "customers",
            table: "customers",
            name: "Customers",
            properties: { id },
            relations: [{
                kind: "hasMany",
                relationName: "orders",
                target: () => orders
            }]
        };
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
        const accounts: CollectionConfig = {
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
        };
        const invoices: CollectionConfig = {
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
        };
        // The address carries the account's id, and the link is its code.
        expect(getParentLinkValues(
            registryOf({ accounts }, { "accounts/a-1/invoices": ["a-1"] }),
            "accounts/a-1/invoices",
            invoices
        )).toEqual({});
    });

    it("leaves a child with no belongsTo on the foreign key alone", () => {
        const loose: CollectionConfig = {
            ...transactions,
            properties: {
                id,
                amount: { type: "number" }
            }
        };
        expect(getParentLinkValues(registry, "customers/c-1/transactions", loose)).toEqual({});
    });
});
