import {
    resolvePropertyEnum,
    resolveEnumValues,
    getSubcollections
} from "../src/util/resolutions";
import { CollectionConfig, NumberProperty, StringProperty, EnumValueConfig } from "@rebasepro/types";

// ─────────────────────────────────────────────────────────────
// resolvePropertyEnum
// ─────────────────────────────────────────────────────────────
describe("resolvePropertyEnum", () => {
    it("resolves enum from object format to EnumValueConfig[]", () => {
        const prop: StringProperty = {
            type: "string",
            name: "Status",
            enum: {
                draft: "Draft",
                published: "Published"
            } as any
        };
        const result = resolvePropertyEnum(prop) as StringProperty;
        expect(result.enum).toEqual([
            { id: "draft",
label: "Draft" },
            { id: "published",
label: "Published" }
        ]);
    });

    it("preserves enum that is already in array format", () => {
        const enumValues: EnumValueConfig[] = [
            { id: "a",
label: "A" },
            { id: "b",
label: "B" }
        ];
        const prop: StringProperty = {
            type: "string",
            name: "Letter",
            enum: enumValues
        };
        const result = resolvePropertyEnum(prop) as StringProperty;
        expect(result.enum).toEqual(enumValues);
    });

    it("filters out invalid enum entries (missing id or label)", () => {
        const prop: StringProperty = {
            type: "string",
            name: "Test",
            enum: {
                valid: "Valid",
                "": "", // empty id and label
                blank: "" // present id, empty label
            } as any
        };
        const result = resolvePropertyEnum(prop) as StringProperty;
        // Asserting only that the valid entry survived left the filter deletable.
        // Pin the whole resulting list instead.
        expect(result.enum as EnumValueConfig[]).toEqual([{ id: "valid",
label: "Valid" }]);
    });

    it("keeps a zero id, which is falsy but legitimate", () => {
        const prop: NumberProperty = {
            type: "number",
            name: "Level",
            enum: [
                { id: 0,
label: "None" },
                { id: 1,
label: "Some" }
            ] as any
        };
        const result = resolvePropertyEnum(prop) as NumberProperty;
        expect(result.enum).toEqual([
            { id: 0,
label: "None" },
            { id: 1,
label: "Some" }
        ]);
    });

    it("handles number property enums", () => {
        const prop: NumberProperty = {
            type: "number",
            name: "Priority",
            enum: {
                1: "Low",
                2: "Medium",
                3: "High"
            } as any
        };
        const result = resolvePropertyEnum(prop) as NumberProperty;
        // `Array.isArray` alone held even if every entry was dropped or garbled.
        expect(result.enum).toEqual([
            { id: "1",
label: "Low" },
            { id: "2",
label: "Medium" },
            { id: "3",
label: "High" }
        ]);
    });
});

// ─────────────────────────────────────────────────────────────
// resolveEnumValues
// ─────────────────────────────────────────────────────────────
describe("resolveEnumValues", () => {
    it("converts object format to EnumValueConfig array", () => {
        const result = resolveEnumValues({ a: "Alpha",
b: "Beta" });
        expect(result).toEqual([
            { id: "a",
label: "Alpha" },
            { id: "b",
label: "Beta" }
        ]);
    });

    it("passes through EnumValueConfig objects", () => {
        const result = resolveEnumValues({
            x: { id: "x",
label: "X",
color: "red" }
        } as any);
        // When value is not a string, it spreads the value and adds id
        expect(result?.[0].id).toBe("x");
        expect(result?.[0].label).toBe("X");
    });

    it("returns undefined for non-object/non-array input", () => {
        // Edge case: string passed as enum (shouldn't happen but defensive)
        expect(resolveEnumValues("invalid" as any)).toBeUndefined();
    });
});


// ─────────────────────────────────────────────────────────────
// getSubcollections
// ─────────────────────────────────────────────────────────────
describe("getSubcollections", () => {
    it("returns subcollections from childCollections function", () => {
        const subCol: CollectionConfig = {
            name: "Comments",
            slug: "comments",
            table: "comments",
            properties: {}
        };
        const collection: CollectionConfig = {
            name: "Posts",
            slug: "posts",
            table: "posts",
            properties: {},
            childCollections: () => [subCol]
        };
        const result = getSubcollections(collection);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("Comments");
    });

    it("returns empty array when no childCollections", () => {
        const collection: CollectionConfig = {
            name: "Posts",
            slug: "posts",
            table: "posts",
            properties: {}
        };
        const result = getSubcollections(collection);
        expect(result).toEqual([]);
    });

    it("returns empty array when childCollections returns undefined", () => {
        const collection: CollectionConfig = {
            name: "Posts",
            slug: "posts",
            table: "posts",
            properties: {},
            childCollections: () => undefined as any
        };
        const result = getSubcollections(collection);
        expect(result).toEqual([]);
    });
});
