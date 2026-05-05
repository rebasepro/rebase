import {
    normalizeToEntityRelation,
    getRelationFrom,
    traverseValueProperty
} from "../src/util/entities";
import { EntityRelation, Property } from "@rebasepro/types";

// ─────────────────────────────────────────────────────────────
// normalizeToEntityRelation
// ─────────────────────────────────────────────────────────────
describe("normalizeToEntityRelation", () => {
    it("returns the same instance if already an EntityRelation", () => {
        const rel = new EntityRelation("123", "users");
        const result = normalizeToEntityRelation(rel);
        expect(result).toBe(rel);
    });

    it("coerces a plain object with __type === 'relation'", () => {
        const obj = { __type: "relation",
id: "abc",
path: "posts" };
        const result = normalizeToEntityRelation(obj);
        expect(result).toBeInstanceOf(EntityRelation);
        expect(result!.id).toBe("abc");
        expect(result!.path).toBe("posts");
    });

    it("coerces a plain object with isEntityRelation() method", () => {
        const obj = {
            id: 42,
            path: "products",
            isEntityRelation: () => true
        };
        const result = normalizeToEntityRelation(obj);
        expect(result).toBeInstanceOf(EntityRelation);
        expect(result!.id).toBe(42);
        expect(result!.path).toBe("products");
    });

    it("returns null for a plain object without relation markers", () => {
        const obj = { id: "x",
path: "users" };
        expect(normalizeToEntityRelation(obj)).toBeNull();
    });

    it("returns null for null", () => {
        expect(normalizeToEntityRelation(null)).toBeNull();
    });

    it("returns null for undefined", () => {
        expect(normalizeToEntityRelation(undefined)).toBeNull();
    });

    it("returns null for primitives", () => {
        expect(normalizeToEntityRelation("string")).toBeNull();
        expect(normalizeToEntityRelation(42)).toBeNull();
        expect(normalizeToEntityRelation(true)).toBeNull();
    });

    it("returns null for arrays", () => {
        expect(normalizeToEntityRelation([1, 2, 3])).toBeNull();
    });

    it("returns null when isEntityRelation() returns false", () => {
        const obj = {
            id: "abc",
            path: "posts",
            isEntityRelation: () => false
        };
        expect(normalizeToEntityRelation(obj)).toBeNull();
    });

    it("includes data from the source object", () => {
        const data = { id: "ent-1",
path: "users",
values: { name: "Alice" } };
        const obj = { __type: "relation",
id: "ent-1",
path: "users",
data };
        const result = normalizeToEntityRelation(obj);
        expect(result).toBeInstanceOf(EntityRelation);
        expect(result!.data).toBe(data);
    });
});

// ─────────────────────────────────────────────────────────────
// getRelationFrom
// ─────────────────────────────────────────────────────────────
describe("getRelationFrom", () => {
    it("creates an EntityRelation from an entity", () => {
        const entity = { id: "r1",
path: "posts",
values: { title: "Test" } };
        const rel = getRelationFrom(entity as any);
        expect(rel).toBeInstanceOf(EntityRelation);
        expect(rel.id).toBe("r1");
        expect(rel.path).toBe("posts");
    });

    it("includes the entity as data", () => {
        const entity = { id: "r2",
path: "users",
values: { name: "Bob" } };
        const rel = getRelationFrom(entity as any);
        expect(rel.data).toBe(entity);
    });

    it("handles numeric IDs", () => {
        const entity = { id: 42,
path: "products",
values: {} };
        const rel = getRelationFrom(entity as any);
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
