import {
    normalizeToSnapshotRelation,
    getRelationFrom,
    traverseValueProperty
} from "../src/util/snapshots";
import { SnapshotRelation, Property } from "@rebasepro/types";

// ─────────────────────────────────────────────────────────────
// normalizeToSnapshotRelation
// ─────────────────────────────────────────────────────────────
describe("normalizeToSnapshotRelation", () => {
    it("returns the same instance if already a SnapshotRelation", () => {
        const rel = new SnapshotRelation("123", "users");
        const result = normalizeToSnapshotRelation(rel);
        expect(result).toBe(rel);
    });

    it("coerces a plain object with __type === 'relation'", () => {
        const obj = { __type: "relation",
id: "abc",
path: "posts" };
        const result = normalizeToSnapshotRelation(obj);
        expect(result).toBeInstanceOf(SnapshotRelation);
        expect(result!.id).toBe("abc");
        expect(result!.path).toBe("posts");
    });

    it("coerces a plain object with isSnapshotRelation() method", () => {
        const obj = {
            id: 42,
            path: "products",
            isSnapshotRelation: () => true
        };
        const result = normalizeToSnapshotRelation(obj);
        expect(result).toBeInstanceOf(SnapshotRelation);
        expect(result!.id).toBe(42);
        expect(result!.path).toBe("products");
    });

    it("returns null for a plain object without relation markers", () => {
        const obj = { id: "x",
path: "users" };
        expect(normalizeToSnapshotRelation(obj)).toBeNull();
    });

    it("returns null for null", () => {
        expect(normalizeToSnapshotRelation(null)).toBeNull();
    });

    it("returns null for undefined", () => {
        expect(normalizeToSnapshotRelation(undefined)).toBeNull();
    });

    it("returns null for primitives", () => {
        expect(normalizeToSnapshotRelation("string")).toBeNull();
        expect(normalizeToSnapshotRelation(42)).toBeNull();
        expect(normalizeToSnapshotRelation(true)).toBeNull();
    });

    it("returns null for arrays", () => {
        expect(normalizeToSnapshotRelation([1, 2, 3])).toBeNull();
    });

    it("returns null when isSnapshotRelation() returns false", () => {
        const obj = {
            id: "abc",
            path: "posts",
            isSnapshotRelation: () => false
        };
        expect(normalizeToSnapshotRelation(obj)).toBeNull();
    });

    it("includes data from the source object", () => {
        const data = { id: "ent-1",
path: "users",
values: { name: "Alice" } };
        const obj = { __type: "relation",
id: "ent-1",
path: "users",
data };
        const result = normalizeToSnapshotRelation(obj);
        expect(result).toBeInstanceOf(SnapshotRelation);
        expect(result!.data).toBe(data);
    });
});

// ─────────────────────────────────────────────────────────────
// getRelationFrom
// ─────────────────────────────────────────────────────────────
describe("getRelationFrom", () => {
    it("creates a SnapshotRelation from a snapshot", () => {
        const snapshot = { id: "r1",
path: "posts",
values: { title: "Test" } };
        const rel = getRelationFrom(snapshot as any);
        expect(rel).toBeInstanceOf(SnapshotRelation);
        expect(rel.id).toBe("r1");
        expect(rel.path).toBe("posts");
    });

    it("includes the snapshot as data", () => {
        const snapshot = { id: "r2",
path: "users",
values: { name: "Bob" } };
        const rel = getRelationFrom(snapshot as any);
        expect(rel.data).toBe(snapshot);
    });

    it("handles numeric IDs", () => {
        const snapshot = { id: 42,
path: "products",
values: {} };
        const rel = getRelationFrom(snapshot as any);
        expect(rel.id).toBe(42);
    });
});

// ─────────────────────────────────────────────────────────────
// traverseValueProperty — oneOf edge cases
// ─────────────────────────────────────────────────────────────
describe("traverseValueProperty — oneOf arrays", () => {
    it("traverses oneOf array using typeField/valueField", () => {
        const property: Property = {
            type: "array",
            name: "Blocks",
            oneOf: {
                typeField: "type",
                valueField: "value",
                properties: {
                    text: { type: "string",
name: "Text" } as Property,
                    number: { type: "number",
name: "Number" } as Property
                }
            }
        } as Property;

        const input = [
            { type: "text",
value: "hello" },
            { type: "number",
value: 42 }
        ];

        const operation = (value: unknown, prop: Property) => {
            if (prop.type === "string" && typeof value === "string") return value.toUpperCase();
            return value;
        };

        const result = traverseValueProperty(input, property, operation) as any[];
        expect(result[0].value).toBe("HELLO");
        expect(result[1].value).toBe(42); // number untouched
    });

    it("handles null items in oneOf array", () => {
        const property: Property = {
            type: "array",
            name: "Blocks",
            oneOf: {
                typeField: "type",
                valueField: "value",
                properties: {
                    text: { type: "string",
name: "Text" } as Property
                }
            }
        } as Property;

        const input = [null, { type: "text",
value: "ok" }];
        const result = traverseValueProperty(input, property, (v) => v) as any[];
        expect(result[0]).toBeNull();
    });

    it("returns items unchanged if oneOf type is not in properties", () => {
        const property: Property = {
            type: "array",
            name: "Blocks",
            oneOf: {
                typeField: "type",
                valueField: "value",
                properties: {
                    text: { type: "string",
name: "Text" } as Property
                }
            }
        } as Property;

        const input = [{ type: "unknown_type",
value: "data" }];
        const result = traverseValueProperty(input, property, (v) => "CHANGED") as any[];
        // Unknown type => returned as-is
        expect(result[0]).toEqual({ type: "unknown_type",
value: "data" });
    });

    it("handles array-of-arrays (tuple-style) with of as array", () => {
        const property: Property = {
            type: "array",
            name: "Pair",
            of: [
                { type: "string",
name: "Key" } as Property,
                { type: "number",
name: "Value" } as Property
            ]
        } as Property;

        const input = ["hello", 42];
        const operation = (value: unknown, prop: Property) => {
            if (prop.type === "string" && typeof value === "string") return value.toUpperCase();
            return value;
        };

        const result = traverseValueProperty(input, property, operation) as any[];
        expect(result[0]).toBe("HELLO");
        expect(result[1]).toBe(42);
    });

    it("returns the input unchanged for non-array, non-map types", () => {
        const property: Property = { type: "string",
name: "Name" } as Property;
        const operation = (value: unknown) => `modified_${value}`;
        const result = traverseValueProperty("original", property, operation);
        expect(result).toBe("modified_original");
    });
});
