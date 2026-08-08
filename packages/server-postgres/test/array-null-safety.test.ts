import { describe, it, expect } from "@jest/globals";
import {
    serializePropertyToServer,
    parsePropertyFromServer,
    serializeDataToServer
} from "../src/data-transformer";
import type { Property, Properties, CollectionConfig } from "@rebasepro/types";

// ─────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────
function makeCollection(slug: string, properties: Properties): CollectionConfig {
    return {
        name: slug,
        slug,
        path: slug,
        collectionType: "postgres",
        tableName: slug,
        properties
    } as unknown as CollectionConfig;
}

// ─────────────────────────────────────────────────────────────
// Property fixtures
// ─────────────────────────────────────────────────────────────
const arrayOfStringsProp: Property = {
    type: "array",
    name: "Tags",
    of: { type: "string", name: "Tag" }
} as Property;

const arrayOfNumbersProp: Property = {
    type: "array",
    name: "Scores",
    of: { type: "number", name: "Score" }
} as Property;

const arrayOfMapsProp: Property = {
    type: "array",
    name: "Addresses",
    of: {
        type: "map",
        name: "Address",
        properties: {
            street: { type: "string", name: "Street" },
            city: { type: "string", name: "City" }
        }
    }
} as Property;

const arrayOneOfProp: Property = {
    type: "array",
    name: "Blocks",
    oneOf: {
        typeField: "type",
        valueField: "value",
        properties: {
            text: { type: "string", name: "Text" } as Property,
            number: { type: "number", name: "Number" } as Property
        }
    }
} as Property;

const arrayOfRelationsProp: Property = {
    type: "array",
    name: "Authors",
    of: { type: "relation", name: "Author" }
} as Property;

// A bare array property without `of` or `oneOf`
const bareArrayProp: Property = {
    type: "array",
    name: "RawArray"
} as Property;

// ─────────────────────────────────────────────────────────────
// 1. serializePropertyToServer — array null safety
// ─────────────────────────────────────────────────────────────
describe("serializePropertyToServer — array null safety", () => {

    // ── Null / undefined early return ──
    it("returns null when value is null with array-of-strings property", () => {
        expect(serializePropertyToServer(null, arrayOfStringsProp)).toBeNull();
    });

    it("returns undefined when value is undefined with array-of-strings property", () => {
        expect(serializePropertyToServer(undefined, arrayOfStringsProp)).toBeUndefined();
    });

    // ── Empty array ──
    it("returns [] when value is an empty array", () => {
        expect(serializePropertyToServer([], arrayOfStringsProp)).toEqual([]);
    });

    // ── Null with different sub-types ──
    it("returns null when value is null with array-of-numbers property", () => {
        expect(serializePropertyToServer(null, arrayOfNumbersProp)).toBeNull();
    });

    it("returns null when value is null with array-of-maps property", () => {
        expect(serializePropertyToServer(null, arrayOfMapsProp)).toBeNull();
    });

    it("returns null when value is null with array oneOf property", () => {
        expect(serializePropertyToServer(null, arrayOneOfProp)).toBeNull();
    });

    // ── Non-array values (rejected) ──
    //
    // These four used to assert `toEqual([])` — they pinned the coercion in
    // place rather than the behaviour anyone wants. A caller that sends a
    // scalar for an array column gets its value destroyed, a 201, and a row
    // that reads back as an empty list forever. The write path refuses it now;
    // the read path (below) still coerces, because a row already in the
    // database is not this caller's fault.
    it("rejects a non-array string for an array property, naming the field", () => {
        expect(() => serializePropertyToServer("not-an-array", arrayOfStringsProp, "tags"))
            .toThrow(/'tags' expects an array, but received a string/);
    });

    it("rejects a non-array number for an array property", () => {
        expect(() => serializePropertyToServer(42, arrayOfStringsProp, "tags"))
            .toThrow(/expects an array, but received a number/);
    });

    it("rejects a non-array object for a bare array property", () => {
        expect(() => serializePropertyToServer({ a: 1 }, bareArrayProp, "tags"))
            .toThrow(/expects an array, but received an object/);
    });

    it("rejects a boolean for an array property", () => {
        expect(() => serializePropertyToServer(true, arrayOfStringsProp)).toThrow(/expects an array/);
        expect(() => serializePropertyToServer(false, arrayOfStringsProp)).toThrow(/expects an array/);
    });

    it("reports the rejection as a 400, not a 500", () => {
        try {
            serializePropertyToServer("news", arrayOfStringsProp, "tags");
            throw new Error("should have thrown");
        } catch (error) {
            expect((error as { statusCode?: number }).statusCode).toBe(400);
            expect((error as { code?: string }).code).toBe("VALIDATION_INVALID_VALUE");
        }
    });

    it("does not echo the rejected value back into the message", () => {
        // Errors end up in logs and in error-reporting services, and the value
        // in the wrong field may be the one worth keeping out of both.
        expect(() => serializePropertyToServer("s3cret-token", arrayOfStringsProp, "tags"))
            .toThrow(/^(?!.*s3cret-token).*$/);
    });

    // ── Arrays with null / undefined elements ──
    it("handles array with null elements by passing each through sub-serialization", () => {
        const result = serializePropertyToServer([null, "a", null], arrayOfStringsProp);
        expect(result).toEqual([null, "a", null]);
    });

    it("handles array with undefined elements by passing each through sub-serialization", () => {
        const result = serializePropertyToServer([undefined, "a"], arrayOfStringsProp);
        expect(result).toEqual([undefined, "a"]);
    });

    // ── Array of relation objects with null entries ──
    it("serializes array of relation objects with null entries correctly", () => {
        const value = [{ id: "1" }, null, { id: "2" }];
        const result = serializePropertyToServer(value, arrayOfRelationsProp);
        // null entries pass through serializePropertyToServer for the sub-property
        // which returns null for null values
        expect(result).toEqual(["1", null, "2"]);
    });

    // ── Array of maps where some entries are null ──
    it("handles array of maps where some entries are null gracefully", () => {
        const value = [
            { street: "123 Main", city: "NYC" },
            null,
            { street: "456 Oak", city: "LA" }
        ];
        const result = serializePropertyToServer(value, arrayOfMapsProp);
        expect(result).toEqual([
            { street: "123 Main", city: "NYC" },
            null,
            { street: "456 Oak", city: "LA" }
        ]);
    });

    // ── Empty array with oneOf property ──
    it("returns [] when value is an empty array with oneOf property", () => {
        expect(serializePropertyToServer([], arrayOneOfProp)).toEqual([]);
    });

    // ── Nested array of arrays (unusual) ──
    it("returns nested array of arrays as-is for bare array property", () => {
        const nested = [["a", "b"], ["c"]];
        // Without `of` or `oneOf`, the array case falls through to `return value`
        expect(serializePropertyToServer(nested, bareArrayProp)).toEqual([["a", "b"], ["c"]]);
    });
});

// ─────────────────────────────────────────────────────────────
// 2. parsePropertyFromServer — array null safety
// ─────────────────────────────────────────────────────────────
describe("parsePropertyFromServer — array null safety", () => {
    const dummyCollection = makeCollection("items", {
        tags: arrayOfStringsProp
    });

    // ── Null / undefined early return ──
    it("returns null when value is null with array property", () => {
        expect(parsePropertyFromServer(null, arrayOfStringsProp, dummyCollection)).toBeNull();
    });

    it("returns undefined when value is undefined with array property", () => {
        expect(parsePropertyFromServer(undefined, arrayOfStringsProp, dummyCollection)).toBeUndefined();
    });

    // ── Empty array ──
    it("returns [] when value is an empty array with array-of-strings", () => {
        expect(parsePropertyFromServer([], arrayOfStringsProp, dummyCollection)).toEqual([]);
    });

    // ── Non-array values (coerced to array) ──
    it("coerces a non-array string to single-element array for array property", () => {
        expect(parsePropertyFromServer("not-an-array", arrayOfStringsProp, dummyCollection)).toEqual(["not-an-array"]);
    });

    it("coerces a non-array number to empty array for array property", () => {
        expect(parsePropertyFromServer(99, arrayOfStringsProp, dummyCollection)).toEqual([]);
    });

    // ── Null with oneOf ──
    it("returns null when value is null with array oneOf property", () => {
        expect(parsePropertyFromServer(null, arrayOneOfProp, dummyCollection)).toBeNull();
    });

    // ── Array with null elements ──
    it("handles array with null elements for parsing gracefully", () => {
        const result = parsePropertyFromServer([null, "a", null], arrayOfStringsProp, dummyCollection);
        expect(result).toEqual([null, "a", null]);
    });

    // ── Falsy non-null values (coerced to array) ──
    it("coerces falsy number 0 to empty array for array property", () => {
        expect(parsePropertyFromServer(0, arrayOfStringsProp, dummyCollection)).toEqual([]);
    });

    it("coerces false to empty array for array property", () => {
        expect(parsePropertyFromServer(false, arrayOfStringsProp, dummyCollection)).toEqual([]);
    });

    it("coerces empty string to single-element array for array property", () => {
        expect(parsePropertyFromServer("", arrayOfStringsProp, dummyCollection)).toEqual([""]);
    });
});

// ─────────────────────────────────────────────────────────────
// 3. serializeDataToServer — entity with null array fields
// ─────────────────────────────────────────────────────────────
describe("serializeDataToServer — entity with null array fields", () => {
    const tagsProperty: Property = {
        type: "array",
        name: "Tags",
        of: { type: "string", name: "Tag" }
    } as Property;

    const categoriesProperty: Property = {
        type: "array",
        name: "Categories",
        of: { type: "string", name: "Category" }
    } as Property;

    const metadataProperty: Property = {
        type: "map",
        name: "Metadata",
        properties: {
            labels: {
                type: "array",
                name: "Labels",
                of: { type: "string", name: "Label" }
            } as Property
        }
    } as Property;

    const properties: Properties = {
        tags: tagsProperty
    };

    // ── Null array field ──
    it("serializes entity with tags: null — scalarData.tags should be null", () => {
        const result = serializeDataToServer(
            { tags: null },
            properties
        );
        expect(result.scalarData.tags).toBeNull();
    });

    // ── Undefined array field ──
    it("serializes entity with tags: undefined — tags value should be undefined in scalarData", () => {
        const result = serializeDataToServer(
            { tags: undefined },
            properties
        );
        // Object.entries iterates keys even when value is undefined,
        // and serializePropertyToServer returns undefined for undefined input
        expect(result.scalarData.tags).toBeUndefined();
    });

    // ── Empty array field ──
    it("serializes entity with tags: [] — scalarData.tags should be []", () => {
        const result = serializeDataToServer(
            { tags: [] },
            properties
        );
        expect(result.scalarData.tags).toEqual([]);
    });

    // ── Multiple array fields, mixed null / populated ──
    it("handles entity with multiple array fields, some null, some populated", () => {
        const multiProperties: Properties = {
            tags: tagsProperty,
            categories: categoriesProperty
        };

        const result = serializeDataToServer(
            { tags: null, categories: ["cat-a", "cat-b"] },
            multiProperties
        );
        expect(result.scalarData.tags).toBeNull();
        expect(result.scalarData.categories).toEqual(["cat-a", "cat-b"]);
    });

    // ── Nested map containing null array ──
    it("handles entity with nested map containing array field that is null", () => {
        const nestedProperties: Properties = {
            metadata: metadataProperty
        };

        const result = serializeDataToServer(
            { metadata: { labels: null } },
            nestedProperties
        );
        // The map serializer recurses into sub-properties; the inner array gets null-checked
        expect(result.scalarData.metadata).toEqual({ labels: null });
    });

    // ── All array fields null ──
    it("handles entity with only array fields, all null — scalarData should have all null values", () => {
        const allArrayProperties: Properties = {
            tags: tagsProperty,
            categories: categoriesProperty
        };

        const result = serializeDataToServer(
            { tags: null, categories: null },
            allArrayProperties
        );
        expect(result.scalarData.tags).toBeNull();
        expect(result.scalarData.categories).toBeNull();
    });
});
