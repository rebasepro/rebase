import { describe, it, expect } from "vitest";
import {
    serializeDataToServer,
    parsePropertyFromServer,
    normalizeDbValues,
    sanitizeAndConvertDates
} from "../src/data-transformer";
import type { EntityCollection, Property, Properties, RelationProperty } from "@rebasepro/types";

// ─────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────
function makeCollection(
    slug: string,
    properties: Properties,
    relations?: EntityCollection["relations"]
): EntityCollection {
    return {
        name: slug,
        slug,
        path: slug,
        collectionType: "postgres",
        tableName: slug,
        properties,
        relations
    } as unknown as EntityCollection;
}

// ─────────────────────────────────────────────────────────────
// serializeDataToServer — typed return (Issue #7 regression)
// ─────────────────────────────────────────────────────────────
describe("serializeDataToServer typed return", () => {
    const properties: Properties = {
        title: { type: "string", name: "Title" } as Property,
        count: { type: "number", name: "Count" } as Property
    };

    it("returns a SerializedEntityData object with scalarData, not raw values", () => {
        const result = serializeDataToServer(
            { title: "Hello", count: 5 },
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
            { title: "Hello World", count: 42 },
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
});

// ─────────────────────────────────────────────────────────────
// parsePropertyFromServer — relation factory (Issue #1 regression)
// ─────────────────────────────────────────────────────────────
describe("parsePropertyFromServer relation factory", () => {
    const targetCollection = makeCollection("authors", {
        name: { type: "string", name: "Name" } as Property
    });

    const collection = makeCollection("posts", {
        author: {
            type: "relation",
            name: "Author",
            relation: {
                target: () => targetCollection,
                cardinality: "one",
                direction: "owning",
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
        title: { type: "string", name: "Title" } as Property,
        price: { type: "number", name: "Price" } as Property,
        created_at: { type: "date", name: "Created" } as Property
    });

    it("coerces string numbers to actual numbers", () => {
        const result = normalizeDbValues(
            { title: "Widget", price: "19.99" } as any,
            collection
        );
        expect(result.price).toBe(19.99);
    });

    it("converts Date objects to { __type: 'date', value: ISO } format", () => {
        const date = new Date("2024-01-15T10:30:00Z");
        const result = normalizeDbValues(
            { title: "Widget", created_at: date } as any,
            collection
        );
        expect(result.created_at).toEqual({
            __type: "date",
            value: "2024-01-15T10:30:00.000Z"
        });
    });

    it("strips unknown database columns not in properties", () => {
        const result = normalizeDbValues(
            { title: "Widget", internal_counter: 999 } as any,
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
                    target: () => collection,
                    cardinality: "one",
                    direction: "owning",
                    localKey: "customer_id",
                    relationName: "customer"
                }
            } as unknown as Property,
            total: { type: "number", name: "Total" } as Property
        });

        const result = normalizeDbValues(
            { customer: "some-id", total: 42 } as any,
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
