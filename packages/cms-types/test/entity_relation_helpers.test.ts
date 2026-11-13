import {
    getRelationFrom,
    traverseValueProperty,
    Property,
    EntityRelation,
    type Entity
} from "@rebasepro/cms-types";

// ─────────────────────────────────────────────────────────────
// getRelationFrom
// ─────────────────────────────────────────────────────────────
describe("getRelationFrom", () => {
    it("creates a EntityRelation from a entity", () => {
        const entity: Entity = { id: "r1",
path: "posts",
values: { title: "Test" } };
        const rel = getRelationFrom(entity);
        expect(rel).toBeInstanceOf(EntityRelation);
        expect(rel.id).toBe("r1");
        expect(rel.path).toBe("posts");
    });

    it("includes the entity as data", () => {
        const entity: Entity = { id: "r2",
path: "users",
values: { name: "Bob" } };
        const rel = getRelationFrom(entity);
        // The entity's fields, carried as the relation's open data record: a
        // copy (the relation does not alias the entity it was built from).
        expect(rel.data).toEqual(entity);
        expect(rel.data).not.toBe(entity);
    });

    it("handles numeric IDs", () => {
        const entity: Entity = { id: 42,
path: "products",
values: {} };
        const rel = getRelationFrom(entity);
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

        const result = traverseValueProperty(input, property, operation);
        expect(result).toEqual([{ type: "text",
value: "HELLO" }, { type: "number",
value: 42 }]); // number untouched
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
        const result = traverseValueProperty(input, property, (v) => v);
        expect(result).toEqual([null, { type: "text",
value: "ok" }]);
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
        const result = traverseValueProperty(input, property, (v) => "CHANGED");
        // Unknown type => returned as-is
        expect(result).toEqual([{ type: "unknown_type",
value: "data" }]);
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

        const result = traverseValueProperty(input, property, operation);
        expect(result).toEqual(["HELLO", 42]);
    });

    it("returns the input unchanged for non-array, non-map types", () => {
        const property: Property = { type: "string",
name: "Name" } as Property;
        const operation = (value: unknown) => `modified_${value}`;
        const result = traverseValueProperty("original", property, operation);
        expect(result).toBe("modified_original");
    });
});
