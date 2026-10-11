import { describe, expect, test } from "@jest/globals";
import { importIntoNewCollection, lostCells } from "./fixtures/pipeline";
import { getWorksheetHeaders } from "../../src/data_import/utils/file_headers";
import { cleanPropertiesFromImport, importedColumnOrder } from "../../src/collection_editor/ui/collection_editor/import/clean_import_data";

/**
 * A file imported into a new collection keeps every value it holds. Each
 * fixture is a shape that once lost data on the way in, silently.
 */
describe("creating a collection from a file keeps every value", () => {

    // The nested keys are slugged (`streetName` → `streetname`) for the
    // schema, and the mapping from the file's key to the slug was computed
    // for the children and then dropped: only `country`, already a slug,
    // survived the import.
    test.each([["p_nested_camel.json"], ["q_nested_camel.csv"]])("nested camelCase, capitalised and spaced keys (%s)", async (file) => {
        const result = await importIntoNewCollection(file);
        expect(lostCells(result)).toEqual([]);
        expect(result.entities[0].values).toMatchObject({ address: { streetname: "Main St", city: "Oslo" } });
    });

    // Each of these columns mixes real numbers with text that `Number()`
    // would change or blank out — zip codes, codes with leading zeros, SKUs a
    // double cannot hold, phone numbers, `N/A`, `1,234`, `$5.00`, `12%`. The
    // majority vote made them numbers and the import changed the text.
    test.each([["b_ids.csv"], ["a_numeric_na.csv"], ["i_numbers.csv"], ["f_nested.json"], ["e_sparse.csv"]])("text that does not spell a number exactly stays text (%s)", async (file) => {
        const result = await importIntoNewCollection(file);
        expect(lostCells(result)).toEqual([]);
    });

    test("zip codes, codes, phone numbers and SKUs are imported as written", async () => {
        const { properties, entities } = await importIntoNewCollection("b_ids.csv");
        for (const key of ["zip", "phone", "code", "sku"]) expect(properties[key].type).toBe("string");
        expect(entities.map(e => e.values)).toEqual([
            { zip: "02134", phone: "555-1234", code: "00123", sku: "12345678901234567890" },
            { zip: "10001", phone: "5551234567", code: "00456", sku: "98765432109876543210" },
            { zip: "94105", phone: "+15551234567", code: "789", sku: "111" },
            { zip: "60601", phone: "5559876543", code: "1000", sku: "222" },
            { zip: "30301", phone: "5550001111", code: "2000", sku: "333" }
        ]);
    });

    test("a price column written with trailing zeros is a number", async () => {
        const { properties, entities } = await importIntoNewCollection("i_numbers.csv");
        expect(properties.float2.type).toBe("number");
        expect(entities[0].values.float2).toBe(10);
        for (const key of ["big", "currency", "thousands", "pct"]) expect(properties[key].type).toBe("string");
        expect(entities[0].values.big).toBe("9007199254740993");
    });

    test("a mostly blank column is not required, and has no blank option", async () => {
        const { properties } = await importIntoNewCollection("e_sparse.csv");
        expect(properties.nickname.validation?.required).toBeUndefined();
        expect(JSON.stringify(properties.nickname)).not.toContain("\"id\":\"\"");
    });
});

describe("every column gets a property of its own", () => {
    // Header slugs collided or came out empty: `First Name` and `first_name`
    // were both `first_name`, `Price ($)` and `Price (€)` both `price_`, and
    // `名前` and `価格` both `""` — one property with an empty key, so one
    // column's values silently overwrote the other's.
    test("headers whose slugs collide or are empty keep their own values", async () => {
        const result = await importIntoNewCollection("j_keys.csv");
        const keys = Object.keys(result.properties);
        expect(keys).not.toContain("");
        const mapped = ["First Name", "first_name", "名前", "価格", "Price ($)", "Price (€)"]
            .map(header => result.headersMapping[header]);
        expect(mapped.every(key => typeof key === "string" && key !== "")).toBe(true);
        expect(new Set(mapped).size).toBe(mapped.length);
        expect(mapped.map(key => result.entities[0].values[key as string]))
            .toEqual(["Ann", "ann", "アン", 100, 1, 2]);
        expect(lostCells(result)).toEqual([]);
    });

    // `x,x` kept only the second column's cells, and every `_`-prefixed
    // column — a Mongo export's `_id` — was left out of the new collection.
    test("a repeated header and a _-prefixed header keep their columns", async () => {
        const result = await importIntoNewCollection("j_keys.csv");
        expect(result.loaded.propertiesOrder).toEqual(expect.arrayContaining(["x", "x_2", "_private"]));
        const values = result.entities.map(e => e.values);
        expect(values.map(v => [v[result.headersMapping["x"] as string], v[result.headersMapping["x_2"] as string]]))
            .toEqual([["x1", "x2"], ["x3", "x4"]]);
        expect(values.map(v => v[result.headersMapping["_private"] as string])).toEqual(["p1", "p2"]);
    });

    test("a spreadsheet's repeated header is a column of its own", () => {
        const headers = getWorksheetHeaders(["x", "x", null, "constructor", "y"]);
        expect(headers.order).toEqual(["x", "x_2", "y"]);
        expect([...headers.byColumn.entries()]).toEqual([[0, "x"], [1, "x_2"], [3, "constructor"], [4, "y"]]);
    });

    // `constructor` and `prototype` are refused as columns, but the file's
    // order kept them, and the dialog read `headersMapping["constructor"]` —
    // `Object` itself on a plain object — so the mapping step crashed and the
    // saved `propertiesOrder` held `{}`.
    test("a constructor or prototype header is no column of the new collection's order", async () => {
        const result = await importIntoNewCollection("j_keys.csv");
        expect(result.loaded.propertiesOrder).not.toContain("constructor");
        expect(result.loaded.propertiesOrder).not.toContain("prototype");
        const order = importedColumnOrder(["name", "constructor", "prototype", "toString", "__proto__"],
            cleanPropertiesFromImport({ name: { type: "string" } }).headersMapping);
        expect(order).toEqual({ headingsOrder: ["name"], propertiesOrder: ["name"] });
        const fromFile = importedColumnOrder(result.loaded.propertiesOrder, result.headersMapping);
        expect(fromFile.propertiesOrder.every(key => typeof key === "string" && key !== "")).toBe(true);
        expect(fromFile.headingsOrder).not.toContain("constructor");
    });
});

describe("the inferred schema accepts the file it was inferred from", () => {
    // A size column `S, M, L, XL, 10, 12` got the enum `[L, M, S, XL]`: the
    // numbers were dropped from it, and their rows refused at save.
    test("an enum holds the numbers a text column mixes in", async () => {
        const { properties, entities } = await importIntoNewCollection("g_enum.csv");
        const size = properties.size as { enum?: Array<{ id: string }> };
        expect(size.enum).toBeDefined();
        const ids = new Set((size.enum ?? []).map(option => option.id));
        for (const entity of entities) expect(ids.has(String(entity.values.size))).toBe(true);
    });

    // With 4 of 5 values valid, the column was inferred `email: true` /
    // `url: true`, and the fifth row was refused at save.
    test("email and url hold only when every value is one", async () => {
        const { properties } = await importIntoNewCollection("h_strings.csv");
        expect(properties.email).not.toHaveProperty("email", true);
        expect(properties.site).not.toHaveProperty("url", true);
    });
});
