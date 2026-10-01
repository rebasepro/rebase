import { buildPropertiesOrder, buildEntityPropertiesFromData } from "../src/collection_builder";
import { DataType, Properties, Property } from "@rebasepro/types";

// Simple type inferrer for testing
function inferType(value: any): DataType {
    if (value === null || value === undefined) return "string";
    if (typeof value === "string") return "string";
    if (typeof value === "number") return "number";
    if (typeof value === "boolean") return "boolean";
    if (value instanceof Date) return "date";
    if (Array.isArray(value)) return "array";
    if (typeof value === "object") return "map";
    return "string";
}

// ─────────────────────────────────────────────────────────────
// buildPropertiesOrder
// ─────────────────────────────────────────────────────────────
describe("buildPropertiesOrder", () => {
    it("prioritizes 'name' and 'title' keys", () => {
        const properties: Properties = {
            description: { type: "string",
name: "Description" } as Property,
            name: { type: "string",
name: "Name" } as Property,
            status: { type: "string",
name: "Status" } as Property
        };
        const order = buildPropertiesOrder(properties);
        expect(order[0]).toBe("name");
    });

    it("prioritizes 'title' key", () => {
        const properties: Properties = {
            zzz: { type: "string",
name: "ZZZ" } as Property,
            title: { type: "string",
name: "Title" } as Property,
            aaa: { type: "string",
name: "AAA" } as Property
        };
        const order = buildPropertiesOrder(properties);
        expect(order[0]).toBe("title");
    });

    it("puts image keys second", () => {
        const properties: Properties = {
            description: { type: "string",
name: "Description" } as Property,
            main_image: { type: "string",
name: "Main Image" } as Property,
            title: { type: "string",
name: "Title" } as Property
        };
        const order = buildPropertiesOrder(properties);
        expect(order.indexOf("title")).toBeLessThan(order.indexOf("main_image"));
        expect(order.indexOf("main_image")).toBeLessThan(order.indexOf("description"));
    });

    it("respects custom priority keys", () => {
        const properties: Properties = {
            slug: { type: "string",
name: "Slug" } as Property,
            custom_field: { type: "string",
name: "Custom" } as Property,
            name: { type: "string",
name: "Name" } as Property
        };
        const order = buildPropertiesOrder(properties, undefined, ["custom_field"]);
        expect(order[0]).toBe("custom_field");
    });

    it("preserves existing propertiesOrder when provided", () => {
        const properties: Properties = {
            a: { type: "string",
name: "A" } as Property,
            b: { type: "string",
name: "B" } as Property
        };
        const order = buildPropertiesOrder(properties, ["b", "a"]);
        expect(order).toEqual(["b", "a"]);
    });

    it("keeps a provided order even when a key would otherwise be prioritized", () => {
        const properties: Properties = {
            zzz: { type: "string",
name: "ZZZ" } as Property,
            title: { type: "string",
name: "Title" } as Property
        };
        // "title" outranks everything when the order is derived; an explicit
        // order is a decision that has already been made and must outrank that.
        expect(buildPropertiesOrder(properties, ["zzz", "title"])).toEqual(["zzz", "title"]);
    });

    it("appends properties the provided order does not mention", () => {
        const properties: Properties = {
            b: { type: "string",
name: "B" } as Property,
            description: { type: "string",
name: "Description" } as Property,
            title: { type: "string",
name: "Title" } as Property
        };
        // A newly inferred column still has to show up, ranked as it would be
        // if the whole order had been derived.
        expect(buildPropertiesOrder(properties, ["b"])).toEqual(["b", "title", "description"]);
    });

    it("does not reorder the array it was given", () => {
        const properties: Properties = {
            a: { type: "string",
name: "A" } as Property,
            title: { type: "string",
name: "Title" } as Property
        };
        // Sorting in place mutated the caller's collection config, so the
        // *stored* order changed as a side effect of asking what it was.
        const providedOrder = ["a", "title"];
        buildPropertiesOrder(properties, providedOrder);
        expect(providedOrder).toEqual(["a", "title"]);
    });

    it("handles empty properties", () => {
        expect(buildPropertiesOrder({})).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────
// buildEntityPropertiesFromData
// ─────────────────────────────────────────────────────────────
describe("buildEntityPropertiesFromData", () => {
    it("infers string properties from data", async () => {
        const data = [
            { name: "Camera",
description: "A great camera" },
            { name: "Lens",
description: "50mm lens" }
        ];
        const properties = await buildEntityPropertiesFromData(data, inferType);
        expect(properties.name).toBeDefined();
        expect(properties.name.type).toBe("string");
        expect(properties.description).toBeDefined();
    });

    it("infers number properties from data", async () => {
        const data = [
            { price: 100,
count: 5 },
            { price: 200,
count: 10 }
        ];
        const properties = await buildEntityPropertiesFromData(data, inferType);
        expect(properties.price.type).toBe("number");
        expect(properties.count.type).toBe("number");
    });

    it("infers boolean properties from data", async () => {
        const data = [
            { active: true },
            { active: false }
        ];
        const properties = await buildEntityPropertiesFromData(data, inferType);
        expect(properties.active.type).toBe("boolean");
    });

    it("infers array properties from data", async () => {
        const data = [
            { tags: ["electronics", "camera"] },
            { tags: ["lens", "photography"] }
        ];
        const properties = await buildEntityPropertiesFromData(data, inferType);
        expect(properties.tags.type).toBe("array");
    });

    it("infers map properties from data", async () => {
        const data = [
            { address: { city: "NYC",
zip: "10001" } },
            { address: { city: "LA",
zip: "90001" } }
        ];
        const properties = await buildEntityPropertiesFromData(data, inferType);
        expect(properties.address.type).toBe("map");
    });

    it("handles mixed types — uses most common type", async () => {
        const data = [
            { value: "hello" },
            { value: "world" },
            { value: 42 }
        ];
        const properties = await buildEntityPropertiesFromData(data, inferType);
        // String should win (2 vs 1)
        expect(properties.value.type).toBe("string");
    });

    it("ignores keys starting with underscore", async () => {
        const data = [
            { _id: "abc",
name: "Test",
_internal: true }
        ];
        const properties = await buildEntityPropertiesFromData(data, inferType);
        expect(properties._id).toBeUndefined();
        expect(properties._internal).toBeUndefined();
        expect(properties.name).toBeDefined();
    });

    it("handles empty data array", async () => {
        const properties = await buildEntityPropertiesFromData([], inferType);
        expect(Object.keys(properties)).toHaveLength(0);
    });

    it("handles null entries in data", async () => {
        const data = [null, { name: "Test" }, null] as any[];
        const properties = await buildEntityPropertiesFromData(data, inferType);
        expect(properties.name).toBeDefined();
    });
});

// ─────────────────────────────────────────────────────────────
// Column names that Object.prototype also has
// ─────────────────────────────────────────────────────────────
describe("buildEntityPropertiesFromData with prototype-named columns", () => {
    /**
     * The counts are records keyed by column name, and a plain object answers
     * `record["constructor"]` with the inherited `Object` function. The count
     * was then written onto the global `Object`, and the values list was
     * `Object.values`, so the import threw. An F1 dataset has a `constructor`
     * column; `toString` and `valueOf` are just as ordinary.
     */
    it("infers them as ordinary columns and leaves Object alone", async () => {
        const properties = await buildEntityPropertiesFromData([
            { constructor: "mclaren", toString: "x", valueOf: 3, hasOwnProperty: true },
            { constructor: "ferrari", toString: "y", valueOf: 4, hasOwnProperty: false },
            { nested: { constructor: "a", toString: "b" } }
        ], inferType);

        expect(properties.constructor).toMatchObject({ type: "string", name: "Constructor" });
        expect(properties.toString).toMatchObject({ type: "string" });
        expect(properties.valueOf).toMatchObject({ type: "number" });
        expect(properties.hasOwnProperty).toMatchObject({ type: "boolean" });
        expect(properties.nested).toMatchObject({
            type: "map",
            properties: { constructor: { type: "string" }, toString: { type: "string" } }
        });
        expect(Object.hasOwn(Object, "string")).toBe(false);
        expect(Object.hasOwn(Object, "number")).toBe(false);
        expect(Object.hasOwn(Object.prototype.toString, "string")).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────
// A column is only inferred as a type its values convert to unchanged
// ─────────────────────────────────────────────────────────────
describe("buildEntityPropertiesFromData never infers a type that loses a value", () => {
    /**
     * A CSV cell is read as a number only when its text is the canonical JSON
     * of one, so `02134`, a 20-digit SKU and `N/A` arrive as text beside the
     * column's real numbers. The majority vote then called the column a
     * number, and the import ran `Number()` on the text: `02134` became 2134,
     * the SKU lost its last digits, and `N/A` became null — silently.
     */
    const typeOf = async (values: unknown[]) =>
        (await buildEntityPropertiesFromData(values.map(value => ({ value })), inferType)).value;

    it.each([
        ["zip codes with a leading zero", ["02134", 10001, 94105]],
        ["SKUs beyond a double's precision", ["12345678901234567890", 111, 222, 333]],
        ["a 16-digit id", ["9007199254740993", 1, 2, 3]],
        ["a number column with N/A and dashes", [10.5, "N/A", 12, "-", 13.25, 14, 15, 16]],
        ["phone numbers", ["555-1234", 5551234567, "+15551234567", 5559876543]],
        ["thousands separators", ["1,234", 999, 3000, 4000]],
        ["numbers and booleans", [1, 0, true, 1]],
        ["text and booleans", [true, false, "maybe", true]]
    ])("%s → string", async (_, values) => {
        expect((await typeOf(values)).type).toBe("string");
    });

    it("a column whose text spells its numbers exactly is a number", async () => {
        // `10.00` is not canonical JSON, so it arrives as text; as a number it
        // is 10 and nothing is lost.
        expect((await typeOf(["10.00", 12.5, "9.99", 5.25, "1e3"])).type).toBe("number");
    });

    it("an array mixing numbers, text and booleans holds strings", async () => {
        const properties = await buildEntityPropertiesFromData([
            { mixed: [1, "two", true] },
            { mixed: ["a", "b"] },
            { mixed: [2, 3] }
        ], inferType);
        expect(properties.mixed).toMatchObject({ type: "array", of: { type: "string" } });
    });

    it("an array of numbers stays an array of numbers", async () => {
        const properties = await buildEntityPropertiesFromData([{ n: [1, 2] }, { n: [3] }], inferType);
        expect(properties.n).toMatchObject({ type: "array", of: { type: "number" } });
    });
});

// ─────────────────────────────────────────────────────────────
// A blank cell is no value
// ─────────────────────────────────────────────────────────────
describe("buildEntityPropertiesFromData reads a blank cell as no value", () => {
    /**
     * A CSV reader hands over `""` for an empty cell where a spreadsheet
     * reader hands over nothing, and the import writes neither. Counted as a
     * value, a column that is 99% blank was `required` with `""` in its enum,
     * and the import then refused the 99 rows it was inferred from.
     */
    const rows = Array.from({ length: 100 }, (_, i) => ({ name: `user${i}`, nickname: i === 42 ? "Bob" : "", score: i }));

    it("a mostly blank column is neither required nor an enum with a blank option", async () => {
        const properties = await buildEntityPropertiesFromData(rows, inferType);
        expect(properties.nickname.type).toBe("string");
        expect(properties.nickname.validation?.required).toBeUndefined();
        expect(JSON.stringify(properties.nickname)).not.toContain("\"id\":\"\"");
    });

    it("infers the same properties whether the reader omits blanks or keeps them", async () => {
        const omitted = rows.map(row => Object.fromEntries(Object.entries(row).filter(([, v]) => v !== "")));
        expect(await buildEntityPropertiesFromData(rows, inferType))
            .toEqual(await buildEntityPropertiesFromData(omitted, inferType));
    });

    it("a number column with a blank cell is still a number", async () => {
        const properties = await buildEntityPropertiesFromData([{ n: 1 }, { n: "" }, { n: 3 }], inferType);
        expect(properties.n.type).toBe("number");
    });
});
