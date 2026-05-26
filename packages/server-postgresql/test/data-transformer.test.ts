import { serializePropertyToServer } from "../src/data-transformer";
import type { Property } from "@rebasepro/types";

describe("serializePropertyToServer", () => {
    // ── Relation property ──
    describe("relation property", () => {
        const relationProp: Property = { type: "relation" } as Property;

        it("should extract id from a relation object", () => {
            const value = { id: "abc-123",
path: "authors",
__type: "relation" };
            expect(serializePropertyToServer(value, relationProp)).toBe("abc-123");
        });

        it("should return null for empty string values", () => {
            expect(serializePropertyToServer("", relationProp)).toBeNull();
        });

        it("should pass through a plain string ID", () => {
            expect(serializePropertyToServer("uuid-string", relationProp)).toBe("uuid-string");
        });

        it("should pass through a numeric ID", () => {
            expect(serializePropertyToServer(42, relationProp)).toBe(42);
        });

        it("should return null for null values", () => {
            expect(serializePropertyToServer(null, relationProp)).toBeNull();
        });

        it("should return undefined for undefined values", () => {
            expect(serializePropertyToServer(undefined, relationProp)).toBeUndefined();
        });

        it("should serialize an array of relation objects to array of IDs", () => {
            const value = [
                { id: "id-1",
path: "authors" },
                { id: "id-2",
path: "authors" }
            ];
            expect(serializePropertyToServer(value, relationProp)).toEqual(["id-1", "id-2"]);
        });

        it("should convert empty strings within arrays to null", () => {
            const value = ["", "some-uuid"];
            expect(serializePropertyToServer(value, relationProp)).toEqual([null, "some-uuid"]);
        });

        it("should handle mixed array of objects and strings", () => {
            const value = [
                { id: "id-1",
path: "authors" },
                "raw-id-2",
                ""
            ];
            expect(serializePropertyToServer(value, relationProp)).toEqual(["id-1", "raw-id-2", null]);
        });
    });

    // ── String property ──
    describe("string property", () => {
        const stringProp: Property = { type: "string" } as Property;

        it("should pass through a regular string", () => {
            expect(serializePropertyToServer("hello", stringProp)).toBe("hello");
        });

        it("should pass through empty string for non-relation types", () => {
            expect(serializePropertyToServer("", stringProp)).toBe("");
        });

        it("should pass through null", () => {
            expect(serializePropertyToServer(null, stringProp)).toBeNull();
        });
    });

    // ── Number property ──
    describe("number property", () => {
        const numberProp: Property = { type: "number" } as Property;

        it("should pass through numeric values", () => {
            expect(serializePropertyToServer(42, numberProp)).toBe(42);
        });

        it("should pass through zero", () => {
            expect(serializePropertyToServer(0, numberProp)).toBe(0);
        });

        it("should pass through null", () => {
            expect(serializePropertyToServer(null, numberProp)).toBeNull();
        });
    });

    // ── Map property ──
    describe("map property", () => {
        const mapProp: Property = {
            type: "map",
            properties: {
                name: { type: "string" } as Property,
                age: { type: "number" } as Property,
                author: { type: "relation" } as Property
            }
        } as unknown as Property;

        it("should recursively serialize nested properties", () => {
            const value = {
                name: "Alice",
                age: 30,
                author: { id: "author-1",
path: "authors" }
            };
            expect(serializePropertyToServer(value, mapProp)).toEqual({
                name: "Alice",
                age: 30,
                author: "author-1"
            });
        });

        it("should convert empty string relation in map to null", () => {
            const value = {
                name: "Test",
                age: 25,
                author: ""
            };
            expect(serializePropertyToServer(value, mapProp)).toEqual({
                name: "Test",
                age: 25,
                author: null
            });
        });

        it("should handle unknown sub-keys by passing through", () => {
            const value = {
                name: "Bob",
                unknownField: "should pass through"
            };
            const result = serializePropertyToServer(value, mapProp) as Record<string, unknown>;
            expect(result.name).toBe("Bob");
            expect(result.unknownField).toBe("should pass through");
        });
    });

    // ── Array property ──
    describe("array property", () => {
        const arrayOfStringsProp: Property = {
            type: "array",
            of: { type: "string" } as Property
        } as unknown as Property;

        it("should serialize array elements through their sub-property type", () => {
            expect(serializePropertyToServer(["a", "b", "c"], arrayOfStringsProp))
                .toEqual(["a", "b", "c"]);
        });

        it("should pass through non-array values", () => {
            expect(serializePropertyToServer("not-an-array", arrayOfStringsProp))
                .toBe("not-an-array");
        });
    });

    // ── Boolean property ──
    describe("boolean property", () => {
        const boolProp: Property = { type: "boolean" } as Property;

        it("should pass through true", () => {
            expect(serializePropertyToServer(true, boolProp)).toBe(true);
        });

        it("should pass through false", () => {
            expect(serializePropertyToServer(false, boolProp)).toBe(false);
        });
    });

    // ── Vector property ──
    describe("vector property", () => {
        const vectorProp: Property = { type: "vector", dimensions: 3 } as Property;

        it("should serialize a Vector instance to a flat array", () => {
            const vectorVal = { __type: "Vector", value: [1.5, -2.0, 3.14] };
            expect(serializePropertyToServer(vectorVal, vectorProp)).toEqual([1.5, -2.0, 3.14]);
        });

        it("should serialize a raw number array to a flat array", () => {
            expect(serializePropertyToServer([0.5, 0.6, 0.7], vectorProp)).toEqual([0.5, 0.6, 0.7]);
        });

        it("should return null for null values", () => {
            expect(serializePropertyToServer(null, vectorProp)).toBeNull();
        });

        it("should return undefined for undefined values", () => {
            expect(serializePropertyToServer(undefined, vectorProp)).toBeUndefined();
        });
    });
});
