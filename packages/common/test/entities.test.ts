import {
    isPropertyBuilder,
    getDefaultValuesFor,
    getDefaultValueFor,
    getDefaultValueFortype,
    updateDateAutoValues,
    sanitizeData,
    getReferenceFrom,
    traverseValuesProperties,
    traverseValueProperty
} from "../src/util/entities";
import {
    Property,
    EntityReference,
    Properties
} from "@rebasepro/types";

// ─────────────────────────────────────────────────────────────
// isPropertyBuilder
// ─────────────────────────────────────────────────────────────
describe("isPropertyBuilder", () => {
    it("returns true for property with dynamicProps function", () => {
        const prop = { type: "string",
name: "Dynamic",
dynamicProps: () => ({}) } as unknown as Property;
        expect(isPropertyBuilder(prop)).toBe(true);
    });

    it("returns false for normal property", () => {
        expect(isPropertyBuilder({ type: "string",
name: "Normal" } as Property)).toBe(false);
    });

    it("returns false for undefined", () => {
        expect(isPropertyBuilder(undefined)).toBeFalsy();
    });
});

describe("getDefaultValueFortype", () => {
    it("returns null for string", () => {
        expect(getDefaultValueFortype("string")).toBeNull();
    });

    it("returns null for number", () => {
        expect(getDefaultValueFortype("number")).toBeNull();
    });

    it("returns false for boolean", () => {
        expect(getDefaultValueFortype("boolean")).toBe(false);
    });

    it("returns null for date", () => {
        expect(getDefaultValueFortype("date")).toBeNull();
    });

    it("returns [] for array", () => {
        expect(getDefaultValueFortype("array")).toEqual([]);
    });

    it("returns {} for map", () => {
        expect(getDefaultValueFortype("map")).toEqual({});
    });
});

describe("getDefaultValueFor", () => {
    it("returns undefined for undefined property", () => {
        expect(getDefaultValueFor(undefined)).toBeUndefined();
    });

    it("returns explicit defaultValue", () => {
        expect(getDefaultValueFor({ type: "string",
name: "Status",
defaultValue: "draft" } as Property)).toBe("draft");
    });

    it("allows null as defaultValue", () => {
        // `StringProperty["defaultValue"]` is `string | undefined`; the point of
        // this case is that an explicit null survives rather than being replaced.
        expect(getDefaultValueFor({ type: "string",
name: "Status",
defaultValue: null } as unknown as Property)).toBeNull();
    });

    it("returns default values for map with nested properties", () => {
        const mapProp: Property = {
            type: "map",
            name: "Address",
            properties: {
                city: { type: "string",
name: "City",
defaultValue: "NYC" } as Property,
                zip: { type: "string",
name: "Zip" } as Property
            }
        };
        const result = getDefaultValueFor(mapProp);
        expect(result).toEqual({ city: "NYC",
zip: null });
    });
});

describe("getDefaultValuesFor", () => {
    it("returns empty object for empty properties", () => {
        expect(getDefaultValuesFor({})).toEqual({});
    });

    it("collects default values from properties", () => {
        const props: Properties = {
            name: { type: "string",
name: "Name" } as Property,
            active: { type: "boolean",
name: "Active" } as Property,
            tags: { type: "array",
name: "Tags" } as Property
        };
        const defaults = getDefaultValuesFor(props);
        expect(defaults.active).toBe(false);
        expect(defaults.tags).toEqual([]);
    });

    it("returns empty object for null/undefined", () => {
        expect(getDefaultValuesFor(undefined as any)).toEqual({});
    });
});

describe("updateDateAutoValues", () => {
    const NOW = "TIMESTAMP_NOW";

    /** The row shape these fixtures describe — otherwise `M` is inferred from
        each `inputValues` literal and the stamped columns are not on it. */
    interface Row extends Record<string, unknown> {
        title?: string;
        created_at?: unknown;
        updated_at?: unknown;
    }

    const properties: Properties = {
        title: { type: "string",
name: "Title" } as Property,
        created_at: { type: "date",
name: "Created At",
autoValue: "on_create" } as Property,
        updated_at: { type: "date",
name: "Updated At",
autoValue: "on_update" } as Property
    };

    it("sets on_create and on_update for new entities", () => {
        const result = updateDateAutoValues<Row>({
            inputValues: { title: "Test" },
            properties,
            status: "new",
            timestampNowValue: NOW
        });
        expect(result.created_at).toBe(NOW);
        expect(result.updated_at).toBe(NOW);
    });

    it("sets on_update but not on_create for existing entities", () => {
        const existingDate = new Date("2023-01-01");
        const result = updateDateAutoValues<Row>({
            inputValues: { title: "Test",
created_at: existingDate },
            properties,
            status: "existing",
            timestampNowValue: NOW
        });
        expect(result.created_at).toEqual(existingDate);
        expect(result.updated_at).toBe(NOW);
    });

    it("sets both on_create and on_update for copy status", () => {
        const result = updateDateAutoValues<Row>({
            inputValues: { title: "Copy" },
            properties,
            status: "copy",
            timestampNowValue: NOW
        });
        expect(result.created_at).toBe(NOW);
        expect(result.updated_at).toBe(NOW);
    });

    it("does not alter non-date properties", () => {
        const result = updateDateAutoValues<Row>({
            inputValues: { title: "Hello" },
            properties,
            status: "new",
            timestampNowValue: NOW
        });
        expect(result.title).toBe("Hello");
    });
});

describe("sanitizeData", () => {
    it("keeps existing values", () => {
        const result = sanitizeData(
            { name: "Test" },
            { name: { type: "string",
name: "Name" } as Property }
        );
        expect(result.name).toBe("Test");
    });

    it("adds null for missing required fields", () => {
        const result = sanitizeData(
            {} as any,
            { email: { type: "string",
name: "Email",
validation: { required: true } } as Property }
        );
        expect(result.email).toBeNull();
    });

    it("does not add null for optional missing fields", () => {
        const result = sanitizeData(
            {},
            { bio: { type: "string",
name: "Bio" } as Property }
        );
        expect(result.bio).toBeUndefined();
    });
});

describe("getReferenceFrom", () => {
    it("creates a EntityReference from a entity", () => {
        const entity = { id: "abc123",
path: "users",
values: { name: "Test" } };
        const ref = getReferenceFrom(entity as any);
        expect(ref).toBeInstanceOf(EntityReference);
        expect(ref.id).toBe("abc123");
        expect(ref.path).toBe("users");
    });

    it("throws for non-string IDs", () => {
        const entity = { id: 42,
path: "users",
values: {} };
        expect(() => getReferenceFrom(entity as any)).toThrow("Only string IDs");
    });
});

describe("traverseValuesProperties", () => {
    it("applies operation to all values", () => {
        const properties: Properties = {
            name: { type: "string",
name: "Name" } as Property,
            age: { type: "number",
name: "Age" } as Property
        };
        const result = traverseValuesProperties(
            { name: "Alice",
age: 30 },
            properties,
            (value) => typeof value === "string" ? (value as string).toUpperCase() : value
        );
        expect(result?.name).toBe("ALICE");
        expect(result?.age).toBe(30);
    });

    it("traverses map properties recursively", () => {
        const properties: Properties = {
            address: {
                type: "map",
                name: "Address",
                properties: {
                    city: { type: "string",
name: "City" } as Property
                }
            } as Property
        };
        const result = traverseValuesProperties(
            { address: { city: "nyc" } },
            properties,
            (value) => typeof value === "string" ? (value as string).toUpperCase() : value
        );
        expect(result?.address?.city).toBe("NYC");
    });

    it("traverses array properties", () => {
        const properties: Properties = {
            tags: {
                type: "array",
                name: "Tags",
                of: { type: "string",
name: "Tag" } as Property
            } as Property
        };
        const result = traverseValuesProperties(
            { tags: ["a", "b"] },
            properties,
            (value) => typeof value === "string" ? (value as string).toUpperCase() : value
        );
        expect(result?.tags).toEqual(["A", "B"]);
    });

    it("handles null/undefined inputValues", () => {
        const properties: Properties = {
            name: { type: "string",
name: "Name" } as Property
        };
        const result = traverseValuesProperties(
            null as any,
            properties,
            (value) => value ?? "default"
        );
        expect(result?.name).toBe("default");
    });
});
