import { CollectionConfig } from "@rebasepro/types";
import { assertKnownWriteFields, assertWriteValuesValid } from "../src/api/rest/write-validation";

/**
 * A write naming a field the collection does not have is a request problem, and
 * used to be reported as nothing at all. It was never true that the key
 * travelled into the INSERT and came back as `column "titel" does not exist` —
 * Drizzle builds the statement from the table's column list, so the key was
 * dropped and the write answered 201. See `write-column-guard.test.ts` in
 * `server-postgres` for the evidence.
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
                kind: "belongsTo",
                relationName: "author",
                target: () => authors,
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

    it("accepts an owning relation's foreign key, which has no property", () => {
        // Callers may set the foreign key directly rather than going through
        // the relation property, and the field is real. Under its wire name:
        // `author_id` is the column, `authorId` is what the API serves and
        // therefore the only spelling a caller can send back.
        expect(() => assertKnownWriteFields({ authorId: 3 }, posts)).not.toThrow();
    });

    it("rejects the raw column name of a derived foreign key", () => {
        // The wire is camelCase throughout. Accepting the column as a second
        // spelling would be the two-conventions defect kept alive in the write
        // path after the read path stopped emitting it.
        expect(() => assertKnownWriteFields({ author_id: 3 }, posts))
            .toThrow(/has no field 'author_id'/);
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
        // populates. The driver still requires the column to exist — see
        // `assertWritableColumns` — which is what makes the opt-out mean
        // something; skipping this check alone dropped the value regardless.
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

/**
 * `validation.min/max/matches/positive/integer` and the date and array bounds
 * were read by the DDL generators (for `integer` and a `varchar` width) and by
 * the admin's client-side form, and by nothing on the write path — while the
 * generated OpenAPI published every one of them as `minimum`, `maximum`,
 * `minLength`, `maxLength` and `pattern`. The docs' own example,
 * `price: { type: "number", validation: { min: 0 } }`, took `-5000` with a 201.
 */
describe("assertWriteValuesValid", () => {
    const products: CollectionConfig = {
        slug: "products",
        name: "Products",
        table: "products",
        properties: {
            price: { type: "number",
validation: { required: true,
min: 0 } },
            stock: { type: "number",
validation: { integer: true,
max: 999 } },
            discount: { type: "number",
validation: { moreThan: 0,
lessThan: 1 } },
            slug: { type: "string",
validation: { matches: "^[a-z0-9-]+$",
min: 3,
max: 40 } },
            code: { type: "string",
validation: { length: 4 } },
            releasedAt: { type: "date",
validation: { min: new Date("2020-01-01T00:00:00.000Z") } },
            tags: { type: "array",
of: { type: "string",
validation: { max: 8 } },
validation: { max: 3 } },
            dimensions: { type: "map",
properties: { width: { type: "number",
validation: { positive: true } } } },
            name: { type: "string" }
        }
    };

    it("rejects a number below `min` — the docs' own example", () => {
        expect(() => assertWriteValuesValid({ price: -5000 }, products))
            .toThrow(/'price' must be at least 0 \(received -5000\)/);
    });

    it("accepts a value inside the range", () => {
        expect(() => assertWriteValuesValid({ price: 0 }, products)).not.toThrow();
        expect(() => assertWriteValuesValid({ price: 19.99 }, products)).not.toThrow();
    });

    it("judges the numeric-string form a JSON body may carry", () => {
        // Postgres accepts `"-5"` for a numeric column, so refusing to look at
        // a string here would leave the constraint bypassable by quoting.
        expect(() => assertWriteValuesValid({ price: "-5" }, products))
            .toThrow(/'price' must be at least 0/);
    });

    it("enforces integer, max, moreThan and lessThan", () => {
        expect(() => assertWriteValuesValid({ stock: 3.7 }, products)).toThrow(/must be a whole number/);
        expect(() => assertWriteValuesValid({ stock: 1000 }, products)).toThrow(/must be at most 999/);
        expect(() => assertWriteValuesValid({ discount: 0 }, products)).toThrow(/must be greater than 0/);
        expect(() => assertWriteValuesValid({ discount: 1 }, products)).toThrow(/must be less than 1/);
        expect(() => assertWriteValuesValid({ stock: 12,
discount: 0.25 }, products)).not.toThrow();
    });

    it("enforces string length bounds and `matches`", () => {
        expect(() => assertWriteValuesValid({ slug: "ab" }, products)).toThrow(/at least 3 characters/);
        expect(() => assertWriteValuesValid({ slug: "a".repeat(41) }, products)).toThrow(/at most 40 characters/);
        expect(() => assertWriteValuesValid({ slug: "Not A Slug!" }, products)).toThrow(/does not match the required pattern/);
        expect(() => assertWriteValuesValid({ code: "abc" }, products)).toThrow(/exactly 4 characters/);
        expect(() => assertWriteValuesValid({ slug: "a-real-slug",
code: "AB12" }, products)).not.toThrow();
    });

    it("does not echo the value that failed a pattern", () => {
        // The message reaches logs, and a pattern usually guards an identifier,
        // a token or a phone number.
        expect(() => assertWriteValuesValid({ slug: "s3cret token" }, products))
            .toThrow(/^(?!.*s3cret).*$/);
    });

    it("enforces date bounds against an ISO string", () => {
        expect(() => assertWriteValuesValid({ releasedAt: "2019-06-01T00:00:00.000Z" }, products))
            .toThrow(/must not be before 2020-01-01T00:00:00.000Z/);
        expect(() => assertWriteValuesValid({ releasedAt: "2024-06-01T00:00:00.000Z" }, products)).not.toThrow();
    });

    it("enforces array bounds, and the element rules the spec publishes as `items`", () => {
        expect(() => assertWriteValuesValid({ tags: ["a", "b", "c", "d"] }, products))
            .toThrow(/'tags' must have at most 3 items/);
        expect(() => assertWriteValuesValid({ tags: ["news", "elections2024"] }, products))
            .toThrow(/'tags\[1\]' must be at most 8 characters/);
        expect(() => assertWriteValuesValid({ tags: ["news"] }, products)).not.toThrow();
    });

    it("reaches into a map's declared sub-properties", () => {
        expect(() => assertWriteValuesValid({ dimensions: { width: -1 } }, products))
            .toThrow(/'dimensions.width' must be positive/);
    });

    it("reports every failing field at once", () => {
        // One field per round trip is how validation errors get ignored.
        expect(() => assertWriteValuesValid({ price: -1,
stock: 3.7,
slug: "no" }, products))
            .toThrow(/'price'.*'stock'.*'slug'/s);
    });

    it("says nothing about a key the collection does not declare", () => {
        // Whether it is allowed at all is `assertKnownWriteFields`' question.
        expect(() => assertWriteValuesValid({ whatever: -1 }, products)).not.toThrow();
    });

    it("says nothing about an absent or null value", () => {
        // A partial update omits keys legitimately, and `required` is a NOT
        // NULL the database enforces on the row, not on this request.
        expect(() => assertWriteValuesValid({}, products)).not.toThrow();
        expect(() => assertWriteValuesValid({ price: null }, products)).not.toThrow();
    });

    it("leaves a wrong-typed value to the database, which types every column", () => {
        expect(() => assertWriteValuesValid({ price: "not a number" }, products)).not.toThrow();
        expect(() => assertWriteValuesValid({ slug: 12 }, products)).not.toThrow();
    });

    it("names the row index for a bulk write, and carries a stable code", () => {
        try {
            assertWriteValuesValid({ price: -1 }, products, { rowIndex: 7 });
            throw new Error("should have thrown");
        } catch (error) {
            expect((error as Error).message).toMatch(/^Row 7: /);
            expect((error as { code?: string }).code).toBe("VALIDATION_CONSTRAINT");
            expect((error as { statusCode?: number }).statusCode).toBe(400);
        }
    });

    it("survives a `matches` the config author wrote wrong", () => {
        const broken: CollectionConfig = {
            slug: "broken",
            name: "Broken",
            table: "broken",
            properties: { ref: { type: "string",
validation: { matches: "([unclosed" } } }
        };
        // Their bug, not the caller's — refusing every write over it would put
        // the blame in the wrong place.
        expect(() => assertWriteValuesValid({ ref: "anything" }, broken)).not.toThrow();
    });

    it("does not let a `g`-flagged pattern accept and reject the same value in turn", () => {
        // A stateful RegExp keeps `lastIndex` between calls, so row 2 of a bulk
        // write would be judged by where row 1's match happened to end.
        const collection: CollectionConfig = {
            slug: "codes",
            name: "Codes",
            table: "codes",
            properties: { ref: { type: "string",
validation: { matches: /[a-z]+/g } } }
        };
        expect(() => assertWriteValuesValid({ ref: "abc" }, collection)).not.toThrow();
        expect(() => assertWriteValuesValid({ ref: "abc" }, collection)).not.toThrow();
    });
});
