import { describe, it, expect } from "@jest/globals";
import {
    serializePropertyToServer,
    parsePropertyFromServer,
    serializeDataToServer
} from "../src/data-transformer";
import type { Property, Properties, SnapshotCollection } from "@rebasepro/types";

// ─────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────
function makeCollection(slug: string, properties: Properties): SnapshotCollection {
    return {
        name: slug,
        slug,
        path: slug,
        collectionType: "postgres",
        tableName: slug,
        properties
    } as unknown as SnapshotCollection;
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

    // ── Non-array values (coerced to empty array) ──
    it("coerces a non-array string to empty array for array property", () => {
        expect(serializePropertyToServer("not-an-array", arrayOfStringsProp)).toEqual([]);
    });

    it("coerces a non-array number to empty array for array property", () => {
        expect(serializePropertyToServer(42, arrayOfStringsProp)).toEqual([]);
    });

    it("coerces a non-array object to empty array for bare array property", () => {
        const obj = { a: 1 };
        expect(serializePropertyToServer(obj, bareArrayProp)).toEqual([]);
    });

    it("coerces a boolean to empty array for array property", () => {
        expect(serializePropertyToServer(true, arrayOfStringsProp)).toEqual([]);
        expect(serializePropertyToServer(false, arrayOfStringsProp)).toEqual([]);
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
// 3. serializeDataToServer — snapshot with null array fields
// ─────────────────────────────────────────────────────────────
describe("serializeDataToServer — snapshot with null array fields", () => {
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
    it("serializes snapshot with tags: null — scalarData.tags should be null", () => {
        const result = serializeDataToServer(
            { tags: null },
            properties
        );
        expect(result.scalarData.tags).toBeNull();
    });

    // ── Undefined array field ──
    it("serializes snapshot with tags: undefined — tags value should be undefined in scalarData", () => {
        const result = serializeDataToServer(
            { tags: undefined },
            properties
        );
        // Object.entries iterates keys even when value is undefined,
        // and serializePropertyToServer returns undefined for undefined input
        expect(result.scalarData.tags).toBeUndefined();
    });

    // ── Empty array field ──
    it("serializes snapshot with tags: [] — scalarData.tags should be []", () => {
        const result = serializeDataToServer(
            { tags: [] },
            properties
        );
        expect(result.scalarData.tags).toEqual([]);
    });

    // ── Multiple array fields, mixed null / populated ──
    it("handles snapshot with multiple array fields, some null, some populated", () => {
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
    it("handles snapshot with nested map containing array field that is null", () => {
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
    it("handles snapshot with only array fields, all null — scalarData should have all null values", () => {
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
