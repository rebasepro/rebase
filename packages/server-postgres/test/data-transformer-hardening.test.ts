import {
    serializeDataToServer,
    parsePropertyFromServer,
    normalizeDbValues,
    sanitizeAndConvertDates
} from "../src/data-transformer";
import type { CollectionConfig, Property, Properties, RelationProperty } from "@rebasepro/types";

// ─────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────
function makeCollection(
    slug: string,
    properties: Properties,
    relations?: CollectionConfig["relations"]
): CollectionConfig {
    return {
        name: slug,
        slug,
        path: slug,
        collectionType: "postgres",
        tableName: slug,
        properties,
        relations
    } as unknown as CollectionConfig;
}

// ─────────────────────────────────────────────────────────────
// serializeDataToServer — typed return (Issue #7 regression)
// ─────────────────────────────────────────────────────────────
describe("serializeDataToServer typed return", () => {
    const properties: Properties = {
        title: { type: "string",
name: "Title" } as Property,
        count: { type: "number",
name: "Count" } as Property
    };

    it("returns a SerializedEntityData object with scalarData, not raw values", () => {
        const result = serializeDataToServer(
            { title: "Hello",
count: 5 },
            properties
        );
        expect(result).toHaveProperty("scalarData");
        expect(result).toHaveProperty("inverseRelationUpdates");
        expect(result).toHaveProperty("joinPathRelationUpdates");
    });

    it("does NOT include __inverseRelationUpdates on scalarData (dunder elimination)", () => {
        const result = serializeDataToServer(
            { title: "Test" },
            properties
        );
        // The old pattern embedded __dunder properties on the result object
        expect(result.scalarData).not.toHaveProperty("__inverseRelationUpdates");
        expect(result.scalarData).not.toHaveProperty("__joinPathRelationUpdates");
    });

    it("returns empty arrays when no collection/registry is provided", () => {
        const result = serializeDataToServer(
            { title: "Test" },
            properties
        );
        expect(result.inverseRelationUpdates).toEqual([]);
        expect(result.joinPathRelationUpdates).toEqual([]);
    });

    it("passes scalar values through correctly", () => {
        const result = serializeDataToServer(
            { title: "Hello World",
count: 42 },
            properties
        );
        expect(result.scalarData.title).toBe("Hello World");
        expect(result.scalarData.count).toBe(42);
    });

    it("handles null/undefined entity gracefully", () => {
        const result = serializeDataToServer(null as any, properties);
        // Object.entries(null) yields nothing → empty object
        expect(result.scalarData).toEqual({});
        expect(result.inverseRelationUpdates).toEqual([]);
        expect(result.joinPathRelationUpdates).toEqual([]);
    });

    // ── `undefined` means "not this field", not "NULL this column" ──
    //
    // `update(id, { title, subtitle: payload.subtitle })` with no subtitle in
    // the payload used to null the column: the key survived with `undefined`,
    // `sanitizeAndConvertDates` turned it into `null`, and Drizzle's
    // `set[col] !== undefined` test then saw a value to write. Unreachable over
    // HTTP (JSON has no `undefined`); the in-process data API hands the
    // caller's object straight to the driver.
    it("drops a key whose value is undefined instead of writing NULL", () => {
        const result = serializeDataToServer(
            { title: "Hello",
subtitle: undefined } as any,
            { ...properties,
subtitle: { type: "string",
name: "Subtitle" } as Property }
        );
        expect(result.scalarData).toEqual({ title: "Hello" });
        expect("subtitle" in result.scalarData).toBe(false);
    });

    it("still writes NULL for an explicit null", () => {
        // The caller who means "clear this column" says so, and is obeyed.
        const result = serializeDataToServer(
            { title: null } as any,
            properties
        );
        expect(result.scalarData).toEqual({ title: null });
    });

    it("drops an undefined value on a key the collection does not declare", () => {
        const result = serializeDataToServer(
            { title: "Hello",
trigger_populated: undefined } as any,
            properties
        );
        expect("trigger_populated" in result.scalarData).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────
// parsePropertyFromServer — relation factory (Issue #1 regression)
// ─────────────────────────────────────────────────────────────
describe("parsePropertyFromServer relation factory", () => {
    const targetCollection = makeCollection("authors", {
        name: { type: "string",
name: "Name" } as Property
    });

    const collection = makeCollection("posts", {
        author: {
            type: "relation",
            name: "Author",
            relation: {
                kind: "belongsTo",
                target: () => targetCollection,
                localKey: "author_id",
                relationName: "author"
            }
        } as unknown as Property
    });

    it("produces a relation ref with __type 'relation' from a string FK value", () => {
        const property = collection.properties.author as Property;
        const result = parsePropertyFromServer("author-123", property, collection, "author") as Record<string, unknown>;
        expect(result.__type).toBe("relation");
        expect(result.id).toBe("author-123");
        expect(result.path).toBe("authors");
    });

    it("produces a relation ref with __type 'relation' from a numeric FK value", () => {
        const property = collection.properties.author as Property;
        const result = parsePropertyFromServer(42, property, collection, "author") as Record<string, unknown>;
        expect(result.__type).toBe("relation");
        expect(result.id).toBe("42");
        expect(result.path).toBe("authors");
    });
});

// ─────────────────────────────────────────────────────────────
// normalizeDbValues — pipeline deduplication (Issue #5 regression)
// ─────────────────────────────────────────────────────────────
describe("normalizeDbValues", () => {
    const collection = makeCollection("items", {
        title: { type: "string",
name: "Title" } as Property,
        price: { type: "number",
name: "Price" } as Property,
        created_at: { type: "date",
name: "Created" } as Property
    });

    it("coerces string numbers to actual numbers", () => {
        const result = normalizeDbValues(
            { title: "Widget",
price: "19.99" } as any,
            collection
        );
        expect(result.price).toBe(19.99);
    });

    it("converts Date objects to { __type: 'date', value: ISO } format", () => {
        const date = new Date("2024-01-15T10:30:00Z");
        const result = normalizeDbValues(
            { title: "Widget",
created_at: date } as any,
            collection
        );
        expect(result.created_at).toEqual({
            __type: "date",
            value: "2024-01-15T10:30:00.000Z"
        });
    });

    it("strips unknown database columns not in properties", () => {
        const result = normalizeDbValues(
            { title: "Widget",
internal_counter: 999 } as any,
            collection
        );
        expect(result).not.toHaveProperty("internal_counter");
        expect(result.title).toBe("Widget");
    });

    it("returns data as-is when properties is empty", () => {
        const empty = makeCollection("empty", {});
        const data = { foo: "bar" };
        const result = normalizeDbValues(data as any, empty);
        expect(result).toEqual({});
    });

    it("handles null data gracefully", () => {
        const result = normalizeDbValues(null as any, collection);
        expect(result).toBeNull();
    });

    it("skips relation properties (they are hydrated by Drizzle)", () => {
        const collectionWithRelation = makeCollection("orders", {
            customer: {
                type: "relation",
                name: "Customer",
                relation: {
                    kind: "belongsTo",
                    target: () => collection,
                    localKey: "customer_id",
                    relationName: "customer"
                }
            } as unknown as Property,
            total: { type: "number",
name: "Total" } as Property
        });

        const result = normalizeDbValues(
            { customer: "some-id",
total: 42 } as any,
            collectionWithRelation
        );
        // Relation properties should be skipped
        expect(result).not.toHaveProperty("customer");
        expect(result.total).toBe(42);
    });
});

// ─────────────────────────────────────────────────────────────
// sanitizeAndConvertDates — utility regression
// ─────────────────────────────────────────────────────────────
describe("sanitizeAndConvertDates", () => {
    it("converts NaN number to null", () => {
        expect(sanitizeAndConvertDates(NaN)).toBeNull();
    });

    it("converts 'NaN' string to null", () => {
        expect(sanitizeAndConvertDates("NaN")).toBeNull();
    });

    it("converts Date to ISO string", () => {
        const date = new Date("2024-01-01T00:00:00Z");
        expect(sanitizeAndConvertDates(date)).toBe("2024-01-01T00:00:00.000Z");
    });

    it("converts ISO string to ISO string", () => {
        const iso = "2024-01-01T00:00:00Z";
        expect(sanitizeAndConvertDates(iso)).toBe("2024-01-01T00:00:00.000Z");
    });

    it("passes through non-date strings unchanged", () => {
        expect(sanitizeAndConvertDates("hello")).toBe("hello");
    });

    it("recursively sanitizes arrays", () => {
        const result = sanitizeAndConvertDates([NaN, "hello", null]);
        expect(result).toEqual([null, "hello", null]);
    });
});

// ─────────────────────────────────────────────────────────────
// getColumnMeta — type guard regression (Issue #6)
// ─────────────────────────────────────────────────────────────
import { getColumnMeta } from "../src/services/collection-helpers";

describe("getColumnMeta type guard", () => {
    it("extracts columnType, dataType, primary from a well-formed column", () => {
        const fakeCol = {
            columnType: "PgVarchar",
            dataType: "string",
            primary: false
        };
        const meta = getColumnMeta(fakeCol as any);
        expect(meta.columnType).toBe("PgVarchar");
        expect(meta.dataType).toBe("string");
        expect(meta.primary).toBe(false);
    });

    it("returns undefined for missing properties instead of crashing", () => {
        const emptyCol = {};
        const meta = getColumnMeta(emptyCol as any);
        expect(meta.columnType).toBeUndefined();
        expect(meta.dataType).toBeUndefined();
        expect(meta.primary).toBeUndefined();
    });

    it("returns undefined for wrong-typed properties instead of passing them through", () => {
        const badCol = {
            columnType: 42, // should be string
            dataType: true, // should be string
            primary: "yes" // should be boolean
        };
        const meta = getColumnMeta(badCol as any);
        expect(meta.columnType).toBeUndefined();
        expect(meta.dataType).toBeUndefined();
        expect(meta.primary).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────
// FK column preservation (Issue #5) — normalizeScalarValues
// ─────────────────────────────────────────────────────────────
describe("normalizeDbValues FK column preservation", () => {
    it("preserves internal FK columns as primitives when not defined as properties", () => {
        const targetCollection = makeCollection("categories", {
            name: { type: "string",
name: "Name" } as Property
        });

        const categoryRelation = {
            target: () => targetCollection,
            kind: "belongsTo" as const,
            localKey: "category_id",
            relationName: "category"
        };

        const collection = makeCollection("products", {
            title: { type: "string",
name: "Title" } as Property,
            category: {
                type: "relation",
                name: "Category",
                relationName: "category"
            } as unknown as Property
        }, [categoryRelation] as any);

        const result = normalizeDbValues(
            { title: "Widget",
categoryId: "cat-123",
category: "ignored" } as any,
            collection
        );

        // FK column should be preserved as a primitive string
        expect(result.categoryId).toBe("cat-123");
        // Relation property should be skipped (db.query handles it)
        expect(result).not.toHaveProperty("category");
        // Regular property should be present
        expect(result.title).toBe("Widget");
    });

    it("preserves numeric FK columns as numbers", () => {
        const targetCollection = makeCollection("authors", {
            name: { type: "string",
name: "Name" } as Property
        });

        const authorRelation = {
            target: () => targetCollection,
            kind: "belongsTo" as const,
            localKey: "author_id",
            relationName: "author"
        };

        const collection = makeCollection("books", {
            title: { type: "string",
name: "Title" } as Property,
            author: {
                type: "relation",
                name: "Author",
                relationName: "author"
            } as unknown as Property
        }, [authorRelation] as any);

        const result = normalizeDbValues(
            { title: "Book",
authorId: 42 } as any,
            collection
        );
        expect(result.authorId).toBe(42);
    });

    it("converts null FK columns to null", () => {
        const targetCollection = makeCollection("authors", {
            name: { type: "string",
name: "Name" } as Property
        });

        const authorRelation = {
            target: () => targetCollection,
            kind: "belongsTo" as const,
            localKey: "author_id",
            relationName: "author"
        };

        const collection = makeCollection("books", {
            title: { type: "string",
name: "Title" } as Property,
            author: {
                type: "relation",
                name: "Author",
                relationName: "author"
            } as unknown as Property
        }, [authorRelation] as any);

        const result = normalizeDbValues(
            { title: "Book",
authorId: null } as any,
            collection
        );
        expect(result.authorId).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────
// Structural dunder guard (Issue #7) — prevent re-introduction
// ─────────────────────────────────────────────────────────────
describe("structural dunder guard", () => {
    it("scalarData never contains any __ prefixed keys", () => {
        const properties: Properties = {
            title: { type: "string",
name: "Title" } as Property,
            count: { type: "number",
name: "Count" } as Property,
            active: { type: "boolean",
name: "Active" } as Property
        };

        const result = serializeDataToServer(
            { title: "Test",
count: 10,
active: true },
            properties
        );

        const dunderKeys = Object.keys(result.scalarData).filter(k => k.startsWith("__"));
        expect(dunderKeys).toEqual([]);
    });

    it("scalarData never contains any __ prefixed keys even with relation properties", () => {
        const targetCollection = makeCollection("tags", {
            label: { type: "string",
name: "Label" } as Property
        });

        const properties: Properties = {
            title: { type: "string",
name: "Title" } as Property,
            tag: {
                type: "relation",
                name: "Tag",
                relation: {
                    kind: "belongsTo",
                    target: () => targetCollection,
                    localKey: "tag_id",
                    relationName: "tag"
                }
            } as unknown as Property
        };

        const result = serializeDataToServer(
            { title: "Test",
tag: { id: "t1",
path: "tags",
__type: "relation" } },
            properties
        );

        const dunderKeys = Object.keys(result.scalarData).filter(k => k.startsWith("__"));
        expect(dunderKeys).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────
// parsePropertyFromServer — vector parsing
// ─────────────────────────────────────────────────────────────
describe("parsePropertyFromServer vector parsing", () => {
    const targetCollection = makeCollection("items", {
        embedding: {
            type: "vector",
            dimensions: 3,
            name: "Embedding"
        } as unknown as Property
    });

    it("parses string representation '[0.1,-0.2,3.14]' from postgres into wrapped vector", () => {
        const property = targetCollection.properties.embedding as Property;
        const result = parsePropertyFromServer("[0.1,-0.2,3.14]", property, targetCollection, "embedding");
        expect(result).toEqual({
            __type: "Vector",
            value: [0.1, -0.2, 3.14]
        });
    });

    it("parses numeric array [0.1,-0.2,3.14] into wrapped vector", () => {
        const property = targetCollection.properties.embedding as Property;
        const result = parsePropertyFromServer([0.1, -0.2, 3.14], property, targetCollection, "embedding");
        expect(result).toEqual({
            __type: "Vector",
            value: [0.1, -0.2, 3.14]
        });
    });
});

// ─────────────────────────────────────────────────────────────
// parsePropertyFromServer — binary parsing
// ─────────────────────────────────────────────────────────────
describe("parsePropertyFromServer binary parsing", () => {
    const targetCollection = makeCollection("items", {
        data: {
            type: "binary",
            name: "Data"
        } as unknown as Property
    });

    it("parses database Buffer into a base64 data URL string", () => {
        const property = targetCollection.properties.data as Property;
        const buffer = Buffer.from("hello");
        const result = parsePropertyFromServer(buffer, property, targetCollection, "data");
        expect(result).toBe("data:application/octet-stream;base64,aGVsbG8=");
    });

    it("parses Buffer object (JSON serialization) into a base64 data URL string", () => {
        const property = targetCollection.properties.data as Property;
        const bufferObj = { type: "Buffer",
data: Array.from(Buffer.from("hello")) };
        const result = parsePropertyFromServer(bufferObj, property, targetCollection, "data");
        expect(result).toBe("data:application/octet-stream;base64,aGVsbG8=");
    });
});
