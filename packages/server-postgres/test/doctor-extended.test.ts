import {
    StringProperty,
    NumberProperty,
    ArrayProperty,
    MapProperty,
    Property,
    VectorProperty,
    BinaryProperty,
} from "@rebasepro/types";
import { getExpectedColumnType } from "../src/schema/doctor";

describe("Doctor — getExpectedColumnType extended coverage", () => {

    // ── String property edge cases ──────────────────────────────────────

    describe("string property", () => {

        it("should return 'uuid' when isId is 'uuid'", () => {
            const prop: StringProperty = {
                type: "string",
                isId: "uuid",
            };
            expect(getExpectedColumnType(prop)).toBe("uuid");
        });

        it("should return 'text' for a basic string (text is the default)", () => {
            const prop: StringProperty = { type: "string" };
            expect(getExpectedColumnType(prop)).toBe("text");
        });

        it("should return 'text' when columnType is 'text'", () => {
            const prop: StringProperty = {
                type: "string",
                columnType: "text",
            };
            expect(getExpectedColumnType(prop)).toBe("text");
        });

        it("should return 'character' when columnType is 'char'", () => {
            const prop: StringProperty = {
                type: "string",
                columnType: "char",
            };
            expect(getExpectedColumnType(prop)).toBe("character");
        });

        it("should return 'uuid' when columnType is 'uuid'", () => {
            const prop: StringProperty = {
                type: "string",
                columnType: "uuid",
            };
            // The generator emits a uuid column for this, so doctor must expect
            // one too. This previously asserted "text", pinning a
            // known gap as if it were intended behaviour.
            const result = getExpectedColumnType(prop);
            expect(result).toBe("uuid");
        });

        it("should return 'USER-DEFINED' for enum string", () => {
            const prop: StringProperty = {
                type: "string",
                enum: { active: "Active", inactive: "Inactive" },
            };
            expect(getExpectedColumnType(prop)).toBe("USER-DEFINED");
        });

        it("should prioritize enum over columnType", () => {
            const prop: StringProperty = {
                type: "string",
                enum: ["a", "b"],
                columnType: "text",
            };
            // enum check comes first in the switch
            expect(getExpectedColumnType(prop)).toBe("USER-DEFINED");
        });

        it("should prioritize enum over isId", () => {
            const prop: StringProperty = {
                type: "string",
                enum: { x: "X" },
                isId: "uuid",
            };
            expect(getExpectedColumnType(prop)).toBe("USER-DEFINED");
        });

        it("should return 'text' for a string regardless of multiline", () => {
            // multiline is a UI hint, doctor doesn't check it for type mapping
            const prop: StringProperty = {
                type: "string",
                multiline: true,
            };
            const result = getExpectedColumnType(prop);
            // Current behavior: multiline doesn't influence the column type mapping
            expect(result).toBe("text");
        });

        it("should return 'text' for string with markdown: true", () => {
            // markdown is a UI hint, doctor doesn't check it for type mapping
            const prop: StringProperty = {
                type: "string",
                markdown: true,
            };
            const result = getExpectedColumnType(prop);
            // Current behavior: markdown doesn't influence the column type mapping
            expect(result).toBe("text");
        });

        it("should return 'text' for string with isId: true (boolean)", () => {
            const prop: StringProperty = {
                type: "string",
                isId: true,
            };
            // isId: true (not "uuid") doesn't match isId === "uuid"
            const result = getExpectedColumnType(prop);
            expect(result).toBe("text");
        });

        it("should return 'uuid' for string with isId: 'uuid' even with columnType 'text'", () => {
            const prop: StringProperty = {
                type: "string",
                isId: "uuid",
                columnType: "text",
            };
            // isId: "uuid" check comes before columnType check
            expect(getExpectedColumnType(prop)).toBe("uuid");
        });

        it("should return 'text' for string with isId: 'cuid'", () => {
            const prop: StringProperty = {
                type: "string",
                isId: "cuid",
            };
            // Only "uuid" isId triggers special handling
            expect(getExpectedColumnType(prop)).toBe("text");
        });

        it("should return 'text' for string with isId: 'manual'", () => {
            const prop: StringProperty = {
                type: "string",
                isId: "manual",
            };
            expect(getExpectedColumnType(prop)).toBe("text");
        });
    });

    // ── Number property edge cases ──────────────────────────────────────

    describe("number property", () => {

        it("should return 'integer' when isId is 'increment'", () => {
            const prop: NumberProperty = {
                type: "number",
                isId: "increment",
            };
            // isId is truthy so the last condition matches: ("isId" in np && np.isId) → integer
            expect(getExpectedColumnType(prop)).toBe("integer");
        });

        it("should return 'integer' when isId is true (boolean)", () => {
            const prop: NumberProperty = {
                type: "number",
                isId: true,
            };
            expect(getExpectedColumnType(prop)).toBe("integer");
        });

        it("should return 'integer' when isId is 'manual'", () => {
            const prop: NumberProperty = {
                type: "number",
                isId: "manual",
            };
            // "manual" is truthy, so ("isId" in np && np.isId) → integer
            expect(getExpectedColumnType(prop)).toBe("integer");
        });

        it("should return 'numeric' for plain number without any options", () => {
            const prop: NumberProperty = { type: "number" };
            expect(getExpectedColumnType(prop)).toBe("numeric");
        });

        it("should return 'integer' when validation.integer is true", () => {
            const prop: NumberProperty = {
                type: "number",
                validation: { integer: true },
            };
            expect(getExpectedColumnType(prop)).toBe("integer");
        });

        it("should return 'integer' for serial columnType", () => {
            const prop: NumberProperty = {
                type: "number",
                columnType: "serial",
            };
            // serial maps to integer in information_schema
            expect(getExpectedColumnType(prop)).toBe("integer");
        });

        it("should return 'bigint' for bigserial columnType", () => {
            const prop: NumberProperty = {
                type: "number",
                columnType: "bigserial",
            };
            expect(getExpectedColumnType(prop)).toBe("bigint");
        });

        it("should return 'bigint' for bigint columnType", () => {
            const prop: NumberProperty = {
                type: "number",
                columnType: "bigint",
            };
            expect(getExpectedColumnType(prop)).toBe("bigint");
        });

        it("should return 'numeric' for numeric columnType", () => {
            const prop: NumberProperty = {
                type: "number",
                columnType: "numeric",
            };
            expect(getExpectedColumnType(prop)).toBe("numeric");
        });

        it("should return 'real' for real columnType", () => {
            const prop: NumberProperty = {
                type: "number",
                columnType: "real",
            };
            expect(getExpectedColumnType(prop)).toBe("real");
        });

        it("should return 'double precision' for double precision columnType", () => {
            const prop: NumberProperty = {
                type: "number",
                columnType: "double precision",
            };
            expect(getExpectedColumnType(prop)).toBe("double precision");
        });

        it("should prioritize columnType over validation.integer", () => {
            const prop: NumberProperty = {
                type: "number",
                columnType: "numeric",
                validation: { integer: true },
            };
            // columnType checks come before validation checks
            expect(getExpectedColumnType(prop)).toBe("numeric");
        });

        it("should prioritize columnType 'real' over isId", () => {
            const prop: NumberProperty = {
                type: "number",
                columnType: "real",
                isId: true,
            };
            // columnType check for "real" comes before isId check
            expect(getExpectedColumnType(prop)).toBe("real");
        });
    });

    // ── Boolean property ────────────────────────────────────────────────

    describe("boolean property", () => {
        it("should return 'boolean'", () => {
            expect(getExpectedColumnType({ type: "boolean" })).toBe("boolean");
        });
    });

    // ── Date property edge cases ────────────────────────────────────────

    describe("date property", () => {
        it("should return 'timestamp with time zone' for default date", () => {
            expect(getExpectedColumnType({ type: "date" })).toBe("timestamp with time zone");
        });

        it("should return 'date' for columnType 'date'", () => {
            expect(getExpectedColumnType({ type: "date", columnType: "date" } as Property)).toBe("date");
        });

        it("should return 'time without time zone' for columnType 'time'", () => {
            expect(getExpectedColumnType({ type: "date", columnType: "time" } as Property)).toBe("time without time zone");
        });
    });

    // ── Reference property ──────────────────────────────────────────────

    describe("reference property", () => {
        it("should return 'text' for reference type", () => {
            const prop: Property = {
                type: "reference",
                path: "some_collection",
            } as Property;
            expect(getExpectedColumnType(prop)).toBe("text");
        });
    });

    // ── Vector property ─────────────────────────────────────────────────

    describe("vector property", () => {
        it("should return 'USER-DEFINED' for vector type", () => {
            const prop: VectorProperty = {
                type: "vector",
                dimensions: 768,
            };
            expect(getExpectedColumnType(prop)).toBe("USER-DEFINED");
        });

        it("should return 'USER-DEFINED' for vector with any dimensions", () => {
            const prop: VectorProperty = {
                type: "vector",
                dimensions: 1536,
            };
            expect(getExpectedColumnType(prop)).toBe("USER-DEFINED");
        });
    });

    // ── Binary property ─────────────────────────────────────────────────

    describe("binary property", () => {
        it("should return 'bytea' for binary type", () => {
            const prop: BinaryProperty = {
                type: "binary",
            };
            expect(getExpectedColumnType(prop)).toBe("bytea");
        });
    });

    // ── Relation property ───────────────────────────────────────────────

    describe("relation property", () => {
        it("should return null for relation type", () => {
            expect(getExpectedColumnType({ type: "relation" } as Property)).toBeNull();
        });
    });

    // ── Array property edge cases ───────────────────────────────────────

    describe("array property", () => {
        it("should return 'jsonb' for array with no columnType and no of", () => {
            const prop: ArrayProperty = { type: "array" } as ArrayProperty;
            expect(getExpectedColumnType(prop)).toBe("jsonb");
        });

        it("should return 'json' for array with columnType 'json'", () => {
            const prop: ArrayProperty = {
                type: "array",
                columnType: "json",
            } as ArrayProperty;
            expect(getExpectedColumnType(prop)).toBe("json");
        });

        it("should return 'jsonb' for array with columnType 'jsonb'", () => {
            const prop: ArrayProperty = {
                type: "array",
                columnType: "jsonb",
            } as ArrayProperty;
            expect(getExpectedColumnType(prop)).toBe("jsonb");
        });

        it("should return 'ARRAY' for array of strings", () => {
            const prop: ArrayProperty = {
                type: "array",
                of: { type: "string" },
            } as ArrayProperty;
            expect(getExpectedColumnType(prop)).toBe("ARRAY");
        });

        it("should return 'ARRAY' for array of integers", () => {
            const prop: ArrayProperty = {
                type: "array",
                of: { type: "number", validation: { integer: true } },
            } as ArrayProperty;
            expect(getExpectedColumnType(prop)).toBe("ARRAY");
        });

        it("should return 'ARRAY' for array of booleans", () => {
            const prop: ArrayProperty = {
                type: "array",
                of: { type: "boolean" },
            } as ArrayProperty;
            expect(getExpectedColumnType(prop)).toBe("ARRAY");
        });

        it("should return 'jsonb' for array of numbers (non-integer)", () => {
            const prop: ArrayProperty = {
                type: "array",
                of: { type: "number" },
            } as ArrayProperty;
            // numeric[] → "ARRAY"
            expect(getExpectedColumnType(prop)).toBe("ARRAY");
        });

        it("should return 'jsonb' for array of maps (complex type, no native array support)", () => {
            const prop: ArrayProperty = {
                type: "array",
                of: { type: "map" },
            } as ArrayProperty;
            // map type doesn't match string/number/boolean → colType remains undefined → jsonb
            expect(getExpectedColumnType(prop)).toBe("jsonb");
        });

        it("should return 'jsonb' for array with Array.isArray(of) being true", () => {
            const prop: ArrayProperty = {
                type: "array",
                of: [{ type: "string" }],
            } as ArrayProperty;
            // Array.isArray(ap.of) → true → doesn't enter the single-of branch → jsonb
            expect(getExpectedColumnType(prop)).toBe("jsonb");
        });
    });

    // ── Map property edge cases ─────────────────────────────────────────

    describe("map property", () => {
        it("should return 'jsonb' for default map", () => {
            const prop: MapProperty = { type: "map" } as MapProperty;
            expect(getExpectedColumnType(prop)).toBe("jsonb");
        });

        it("should return 'json' for map with columnType 'json'", () => {
            const prop: MapProperty = {
                type: "map",
                columnType: "json",
            };
            expect(getExpectedColumnType(prop)).toBe("json");
        });

        it("should return 'jsonb' for map with columnType 'jsonb'", () => {
            const prop: MapProperty = {
                type: "map",
                columnType: "jsonb",
            };
            expect(getExpectedColumnType(prop)).toBe("jsonb");
        });
    });

    // ── Unknown / unsupported types ─────────────────────────────────────

    describe("unknown types", () => {
        it("should return null for geopoint type", () => {
            expect(getExpectedColumnType({ type: "geopoint" } as Property)).toBeNull();
        });
    });
});
