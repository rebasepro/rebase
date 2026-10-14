import React from "react";
import { render } from "@testing-library/react";
import type { AdminCollection } from "@rebasepro/cms-types";
import { useColumnIds } from "../../src/components/common/useColumnsIds";

/**
 * A collection table shows a row's id once.
 *
 * Every collection table opens with its own ID column: the row's id, next to
 * its checkbox and menu. A collection that declares its key as a property —
 * `id: { name: "ID", type: "number", isId: "increment" }`, which is how every
 * scaffolded collection starts — got that property's column as well: two
 * columns headed "ID", side by side, holding the same value. The relation
 * picker ("Select Tag") and the collection view both showed it, because both
 * take their columns from `useColumnIds`.
 *
 * The property's column is the one dropped. That is the rule the record form
 * already follows (a single surrogate key is routed out of the fields and into
 * the record block, `form-layout.ts`) and the CSV export too (the file's own
 * `id` column, never the property's). A composite key is not a row id: its
 * columns are data, and they stay. With `hideIdFromCollection` the ID column
 * shows no id, so the property's column is then where it is read.
 */

const columnsOf = (collection: AdminCollection): string[] => {
    const state: { current?: { key: string }[] } = {};
    function Probe() {
        state.current = useColumnIds(collection, false);
        return null;
    }
    render(React.createElement(Probe));
    return state.current!.map(c => c.key);
};

const tags = (extra: Record<string, unknown> = {}) => ({
    slug: "tags",
    name: "Tags",
    table: "tags",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        name: { name: "Tag Name", type: "string" }
    },
    ...extra
}) as unknown as AdminCollection;

describe("the id column of a collection table", () => {

    it("is not repeated by the key property's own column", () => {
        expect(columnsOf(tags())).toEqual(["name"]);
    });

    it("is not repeated when propertiesOrder names the key", () => {
        expect(columnsOf(tags({ propertiesOrder: ["id", "name"] }))).toEqual(["name"]);
    });

    it("is not repeated by a key with another name", () => {
        const products = {
            slug: "products",
            name: "Products",
            table: "products",
            properties: {
                sku: { name: "SKU", type: "string", isId: "manual" },
                name: { name: "Name", type: "string" }
            }
        } as unknown as AdminCollection;
        expect(columnsOf(products)).toEqual(["name"]);
    });

    it("is the key property's column when the ID column hides its id", () => {
        expect(columnsOf(tags({ hideIdFromCollection: true }))).toEqual(["id", "name"]);
    });

    it("leaves a composite key's columns, which are data", () => {
        const orderItems = {
            slug: "order_items",
            name: "Order items",
            table: "order_items",
            properties: {
                order_id: { name: "Order", type: "string", isId: "manual" },
                product_id: { name: "Product", type: "string", isId: "manual" },
                quantity: { name: "Quantity", type: "number" }
            }
        } as unknown as AdminCollection;
        expect(columnsOf(orderItems)).toEqual(["order_id", "product_id", "quantity"]);
    });

    it("leaves an `id` property that is not declared as the key", () => {
        const notes = {
            slug: "notes",
            name: "Notes",
            table: "notes",
            properties: {
                id: { name: "ID", type: "string" },
                body: { name: "Body", type: "string" }
            }
        } as unknown as AdminCollection;
        expect(columnsOf(notes)).toEqual(["id", "body"]);
    });
});
