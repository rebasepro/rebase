import { describe, expect, test } from "@jest/globals";
import { importIntoNewCollection, lostCells } from "./fixtures/pipeline";

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
