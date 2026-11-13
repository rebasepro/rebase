import { sanitizeAndConvertDates, serializeColumnToServer, serializeRelationValue } from "../src/data-transformer";
import { col, json } from "@rebasepro/types";
import { columnOf } from "./helpers/codec-columns";

describe("serializeRelationValue", () => {
    it("should extract id from a relation object", () => {
        const value = { id: "abc-123",
path: "authors",
__type: "relation" };
        expect(serializeRelationValue(value)).toBe("abc-123");
    });

    it("should return null for empty string values", () => {
        expect(serializeRelationValue("")).toBeNull();
    });

    it("should pass through a plain string ID", () => {
        expect(serializeRelationValue("uuid-string")).toBe("uuid-string");
    });

    it("should pass through a numeric ID", () => {
        expect(serializeRelationValue(42)).toBe(42);
    });

    it("should return null for null values", () => {
        expect(serializeRelationValue(null)).toBeNull();
    });

    it("should return undefined for undefined values", () => {
        expect(serializeRelationValue(undefined)).toBeUndefined();
    });

    it("should serialize an array of relation objects to array of IDs", () => {
        const value = [
            { id: "id-1",
path: "authors" },
            { id: "id-2",
path: "authors" }
        ];
        expect(serializeRelationValue(value)).toEqual(["id-1", "id-2"]);
    });

    it("should convert empty strings within arrays to null", () => {
        expect(serializeRelationValue(["", "some-uuid"])).toEqual([null, "some-uuid"]);
    });

    it("should handle mixed array of objects, strings and nulls", () => {
        const value = [
            { id: "id-1",
path: "authors" },
            "raw-id-2",
            "",
            null
        ];
        expect(serializeRelationValue(value)).toEqual(["id-1", "raw-id-2", null, null]);
    });
});

describe("serializeColumnToServer", () => {
    // ── Text column ──
    describe("text column", () => {
        const text = columnOf(col.text());

        it("should pass through a regular string", () => {
            expect(serializeColumnToServer("hello", text)).toBe("hello");
        });

        it("should pass through empty string", () => {
            expect(serializeColumnToServer("", text)).toBe("");
        });

        it("should pass through null", () => {
            expect(serializeColumnToServer(null, text)).toBeNull();
        });
    });

    // ── Numeric column ──
    describe("numeric column", () => {
        const integer = columnOf(col.integer());

        it("should pass through numeric values", () => {
            expect(serializeColumnToServer(42, integer)).toBe(42);
        });

        it("should pass through zero", () => {
            expect(serializeColumnToServer(0, integer)).toBe(0);
        });

        it("should pass through null", () => {
            expect(serializeColumnToServer(null, integer)).toBeNull();
        });

        it("should write a number that did not parse as null", () => {
            expect(serializeColumnToServer("NaN", columnOf(col.numeric()))).toBeNull();
        });
    });

    // ── JSON object column ──
    // A relation inside a JSON document is not something the table model can
    // say (the lift refuses it), so the document's fields here are scalars.
    describe("json object column", () => {
        const document = columnOf(col.jsonb(json.object({
            name: json.string(),
            age: json.number(),
            seenAt: json.date()
        })));

        it("should recursively serialize nested fields", () => {
            const value = {
                name: "Alice",
                age: "NaN",
                seenAt: "2024-01-01T00:00:00Z"
            };
            expect(serializeColumnToServer(value, document)).toEqual({
                name: "Alice",
                age: null,
                seenAt: "2024-01-01T00:00:00.000Z"
            });
        });

        it("should handle unknown sub-keys by passing through", () => {
            const value = {
                name: "Bob",
                unknownField: "should pass through"
            };
            const result = serializeColumnToServer(value, document) as Record<string, unknown>;
            expect(result.name).toBe("Bob");
            expect(result.unknownField).toBe("should pass through");
        });
    });

    // ── Native array column ──
    describe("array column", () => {
        const strings = columnOf(col.text().array());
        const numbers = columnOf(col.numeric().array());

        it("should serialize array elements through their element type", () => {
            expect(serializeColumnToServer(["a", "b", "c"], strings)).toEqual(["a", "b", "c"]);
            expect(serializeColumnToServer([1, "NaN"], numbers)).toEqual([1, null]);
        });

        // Was "should coerce non-array values to empty array". The coercion it
        // asserted threw the caller's value away and answered 201 — a test that
        // pinned a bug in place rather than a behaviour.
        it("should reject a non-array value for an array column", () => {
            expect(() => serializeColumnToServer("not-an-array", strings, "tags"))
                .toThrow(/'tags' expects an array/);
        });

        // --- Null safety ---
        it("should return null for null array value", () => {
            expect(serializeColumnToServer(null, strings)).toBeNull();
        });

        it("should return undefined for undefined array value", () => {
            expect(serializeColumnToServer(undefined, strings)).toBeUndefined();
        });

        it("should return empty array for empty array value", () => {
            expect(serializeColumnToServer([], strings)).toEqual([]);
        });

        it("should return null for null value on an array of numbers", () => {
            expect(serializeColumnToServer(null, numbers)).toBeNull();
        });

        it("should handle array with null elements", () => {
            expect(serializeColumnToServer([null, "a", null, "b"], strings)).toEqual([null, "a", null, "b"]);
        });

        it("should reject a number value for an array column", () => {
            expect(() => serializeColumnToServer(42, strings)).toThrow(/expects an array/);
        });

        it("should reject a boolean value for an array column", () => {
            expect(() => serializeColumnToServer(true, strings)).toThrow(/expects an array/);
        });

        it("should reject an object value for an array column", () => {
            expect(() => serializeColumnToServer({ a: 1 }, strings)).toThrow(/expects an array/);
        });
    });

    // ── Boolean column ──
    describe("boolean column", () => {
        const bool = columnOf(col.boolean());

        it("should pass through true", () => {
            expect(serializeColumnToServer(true, bool)).toBe(true);
        });

        it("should pass through false", () => {
            expect(serializeColumnToServer(false, bool)).toBe(false);
        });
    });

    // ── Vector column ──
    describe("vector column", () => {
        const vector = columnOf(col.vector({ dimensions: 3 }));

        it("should serialize a Vector envelope to a flat array", () => {
            const vectorVal = { __type: "Vector",
value: [1.5, -2.0, 3.14] };
            expect(serializeColumnToServer(vectorVal, vector)).toEqual([1.5, -2.0, 3.14]);
        });

        it("should serialize a raw number array to a flat array", () => {
            expect(serializeColumnToServer([0.5, 0.6, 0.7], vector)).toEqual([0.5, 0.6, 0.7]);
        });

        it("should return null for null values", () => {
            expect(serializeColumnToServer(null, vector)).toBeNull();
        });

        it("should return undefined for undefined values", () => {
            expect(serializeColumnToServer(undefined, vector)).toBeUndefined();
        });
    });

    // ── bytea column ──
    describe("bytea column", () => {
        const bytes = columnOf(col.bytea());

        it("should serialize a base64 data URL to a Buffer", () => {
            const base64Data = "data:application/octet-stream;base64,aGVsbG8=";
            const result = serializeColumnToServer(base64Data, bytes);
            expect(Buffer.isBuffer(result)).toBe(true);
            expect(Buffer.isBuffer(result) ? result.toString("utf8") : undefined).toBe("hello");
        });

        it("should pass through a Buffer as-is", () => {
            const buffer = Buffer.from("world");
            expect(serializeColumnToServer(buffer, bytes)).toBe(buffer);
        });

        it("should return null for null values", () => {
            expect(serializeColumnToServer(null, bytes)).toBeNull();
        });
    });

    // ── A type Rebase does not create ──
    describe("custom column", () => {
        it("passes the value through as sent", () => {
            const inet = columnOf(col.custom({ dataType: "inet" }));
            expect(serializeColumnToServer("10.0.0.1", inet)).toBe("10.0.0.1");
            expect(serializeColumnToServer("data:application/octet-stream;base64,AQID", inet))
                .toBe("data:application/octet-stream;base64,AQID");
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

    it("keeps a data URL decoded by serializeColumnToServer a Buffer", () => {
        const decoded = serializeColumnToServer("data:application/octet-stream;base64,AQID", columnOf(col.bytea()));
        const out = sanitizeAndConvertDates({ audio: decoded }) as { audio: unknown };
        expect(Buffer.isBuffer(out.audio)).toBe(true);
    });
});
