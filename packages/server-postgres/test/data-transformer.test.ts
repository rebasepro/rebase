import { sanitizeAndConvertDates, serializePropertyToServer } from "../src/data-transformer";
import type { Property } from "@rebasepro/types";

describe("serializePropertyToServer", () => {
    // ── Relation property ──
    describe("relation property", () => {
        const relationProp: Property = { type: "relation" };

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
        const stringProp: Property = { type: "string" };

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
        const numberProp: Property = { type: "number" };

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
                name: { type: "string" },
                age: { type: "number" },
                author: { type: "relation" }
            }
        };

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
            of: { type: "string" }
        };

        const arrayOfNumbersProp: Property = {
            type: "array",
            of: { type: "number" }
        };

        const arrayOfRelationsProp: Property = {
            type: "array",
            of: { type: "relation" }
        };

        it("should serialize array elements through their sub-property type", () => {
            expect(serializePropertyToServer(["a", "b", "c"], arrayOfStringsProp))
                .toEqual(["a", "b", "c"]);
        });

        // Was "should coerce non-array values to empty array". The coercion it
        // asserted threw the caller's value away and answered 201 — a test that
        // pinned a bug in place rather than a behaviour.
        it("should reject a non-array value for an array property", () => {
            expect(() => serializePropertyToServer("not-an-array", arrayOfStringsProp, "tags"))
                .toThrow(/'tags' expects an array/);
        });

        // --- Null safety ---
        it("should return null for null array value", () => {
            expect(serializePropertyToServer(null, arrayOfStringsProp)).toBeNull();
        });

        it("should return undefined for undefined array value", () => {
            expect(serializePropertyToServer(undefined, arrayOfStringsProp)).toBeUndefined();
        });

        it("should return empty array for empty array value", () => {
            expect(serializePropertyToServer([], arrayOfStringsProp)).toEqual([]);
        });

        it("should return null for null value with array-of-numbers property", () => {
            expect(serializePropertyToServer(null, arrayOfNumbersProp)).toBeNull();
        });

        it("should handle array with null elements", () => {
            const result = serializePropertyToServer([null, "a", null, "b"], arrayOfStringsProp);
            expect(result).toEqual([null, "a", null, "b"]);
        });

        it("should handle array of relation objects with null entries", () => {
            const value = [{ id: "1", path: "tags" }, null, { id: "2", path: "tags" }];
            const result = serializePropertyToServer(value, arrayOfRelationsProp);
            expect(result).toEqual(["1", null, "2"]);
        });

        it("should reject a number value for an array property", () => {
            expect(() => serializePropertyToServer(42, arrayOfStringsProp)).toThrow(/expects an array/);
        });

        it("should reject a boolean value for an array property", () => {
            expect(() => serializePropertyToServer(true, arrayOfStringsProp)).toThrow(/expects an array/);
        });

        it("should reject an object value for an array property", () => {
            expect(() => serializePropertyToServer({ a: 1 }, arrayOfStringsProp)).toThrow(/expects an array/);
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
        const vectorProp: Property = { type: "vector",
dimensions: 3 } as Property;

        it("should serialize a Vector instance to a flat array", () => {
            const vectorVal = { __type: "Vector",
value: [1.5, -2.0, 3.14] };
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

    // ── Binary property ──
    describe("binary property", () => {
        const binaryProp: Property = { type: "binary" } as Property;

        it("should serialize a base64 data URL to a Buffer", () => {
            const base64Data = "data:application/octet-stream;base64,aGVsbG8=";
            const result = serializePropertyToServer(base64Data, binaryProp);
            expect(Buffer.isBuffer(result)).toBe(true);
            expect((result as Buffer).toString("utf8")).toBe("hello");
        });

        it("should pass through a Buffer as-is", () => {
            const buffer = Buffer.from("world");
            expect(serializePropertyToServer(buffer, binaryProp)).toBe(buffer);
        });

        it("should return null for null values", () => {
            expect(serializePropertyToServer(null, binaryProp)).toBeNull();
        });
    });
});

describe("sanitizeAndConvertDates", () => {
    // A binary value written through dataAsAdmin reached the column as
    // `{"0":1,"1":2,…}`: the walk copied the Buffer key by key into a plain
    // object, and the driver JSON-encoded that.
    it("passes a Buffer through as a Buffer", () => {
        const out = sanitizeAndConvertDates({ audio: Buffer.from([1, 2, 3]) }) as { audio: unknown };
        expect(Buffer.isBuffer(out.audio)).toBe(true);
        expect([...(out.audio as Buffer)]).toEqual([1, 2, 3]);
    });

    it("passes a Uint8Array through untouched", () => {
        const bytes = new Uint8Array([4, 5]);
        const out = sanitizeAndConvertDates({ audio: bytes }) as { audio: unknown };
        expect(out.audio).toBe(bytes);
    });

    it("turns a bare ArrayBuffer into a Buffer of the same bytes, not {}", () => {
        const buffer = new Uint8Array([7, 8, 9]).buffer;
        const out = sanitizeAndConvertDates({ audio: buffer, nested: [buffer] }) as { audio: unknown; nested: unknown[] };
        expect(Buffer.isBuffer(out.audio)).toBe(true);
        expect([...(out.audio as Buffer)]).toEqual([7, 8, 9]);
        expect(Buffer.isBuffer(out.nested[0])).toBe(true);
    });

    it("keeps a data URL decoded by serializePropertyToServer a Buffer", () => {
        const decoded = serializePropertyToServer("data:application/octet-stream;base64,AQID", { type: "binary" } as Property);
        const out = sanitizeAndConvertDates({ audio: decoded }) as { audio: unknown };
        expect(Buffer.isBuffer(out.audio)).toBe(true);
    });
});
