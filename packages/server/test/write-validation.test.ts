import { CollectionConfig } from "@rebasepro/types";
import { assertKnownWriteFields } from "../src/api/rest/write-validation";

/**
 * A write naming a field the collection does not have is a request problem, and
 * used to be reported as a database one: the key travelled into the INSERT and
 * came back as `column "titel" does not exist`, phrased by Postgres, from a
 * stack the caller never sees.
 */
describe("assertKnownWriteFields", () => {
    const posts: CollectionConfig = {
        slug: "posts",
        name: "Posts",
        table: "posts",
        properties: {
            id: { type: "number",
isId: "increment" },
            title: { type: "string" },
            author: { type: "relation",
relationName: "author" }
        },
        relations: [
            {
                relationName: "author",
                target: () => authors,
                cardinality: "one",
                direction: "owning",
                localKey: "author_id"
            }
        ]
    };

    const authors: CollectionConfig = {
        slug: "authors",
        name: "Authors",
        table: "authors",
        properties: { id: { type: "number",
isId: "increment" } }
    };

    // Keyed on `sku`: there is no `id` column for `create(data, id)` to fill.
    const skuItems: CollectionConfig = {
        slug: "sku_items",
        name: "SKU Items",
        table: "sku_items",
        properties: {
            sku: { type: "string",
isId: true },
            label: { type: "string" }
        }
    };

    it("accepts declared fields", () => {
        expect(() => assertKnownWriteFields({ title: "Hello" }, posts)).not.toThrow();
    });

    it("accepts an owning relation's foreign-key column, which has no property", () => {
        // Callers may set `author_id` directly rather than going through the
        // relation property, and the column is real.
        expect(() => assertKnownWriteFields({ author_id: 3 }, posts)).not.toThrow();
    });

    it("rejects a typo, naming it and what was available", () => {
        expect(() => assertKnownWriteFields({ titel: "Hello" }, posts))
            .toThrow(/'posts' has no field 'titel'.*Known fields:.*'title'/s);
    });

    it("names every unknown field, not just the first", () => {
        expect(() => assertKnownWriteFields({ titel: "x",
autor: "y" }, posts))
            .toThrow(/'titel', 'autor'/);
    });

    it("explains the `id` case, which the caller did not choose to send", () => {
        // `create(data, "ABC-1")` puts the address in an `id` column. Right for
        // an id-keyed table; meaningless here, and a bare "no field 'id'" would
        // send the reader hunting through their own code for it.
        expect(() => assertKnownWriteFields({ id: "ABC-1",
label: "Widget" }, skuItems))
            .toThrow(/has no 'id' column — it is keyed on 'sku'.*put the key in `data`/s);
    });

    it("accepts `id` where `id` really is a column", () => {
        expect(() => assertKnownWriteFields({ id: 1,
title: "Hello" }, posts)).not.toThrow();
    });

    it("names the row index for a bulk write", () => {
        expect(() => assertKnownWriteFields({ titel: "x" }, posts, { rowIndex: 3 }))
            .toThrow(/^Row 3: /);
    });

    it("says nothing about a collection that declares no properties", () => {
        // An empty property set describes nothing, so there is nothing to check
        // against — that is not the same claim as "no fields are allowed".
        const opaque: CollectionConfig = { slug: "opaque",
name: "Opaque",
table: "opaque",
properties: {} };
        expect(() => assertKnownWriteFields({ anything: 1 }, opaque)).not.toThrow();
    });

    it("lets everything through when the collection opts out", () => {
        // For a column the config never declared but a trigger or default
        // populates.
        expect(() => assertKnownWriteFields({ titel: "x" }, { ...posts,
strictWrites: false })).not.toThrow();
    });

    it("carries a stable code for clients to branch on", () => {
        try {
            assertKnownWriteFields({ titel: "x" }, posts);
            throw new Error("should have thrown");
        } catch (error) {
            expect((error as { code?: string }).code).toBe("VALIDATION_UNKNOWN_FIELDS");
            expect((error as { statusCode?: number }).statusCode).toBe(400);
        }
    });
});
