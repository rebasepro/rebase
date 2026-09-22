import { describe, expect, jest, test } from "@jest/globals";
import { CollectionRegistryController, Properties } from "@rebasepro/types";
import { AuthController } from "@rebasepro/cms-types";
import { convertFileToJson } from "../../src/data_import/utils/file_to_json";
import { convertDataToEntity, processValueMapping } from "../../src/data_import/utils/data";

/**
 * A CSV cell is text, and what it means depends on the property it lands in.
 * Every cell used to be run through `JSON.parse` as the file was read — before
 * the target was known — so a string column lost its exact text (`1.10`,
 * `12345678901234567890`, `null`), and the boolean `TRUE` that Excel and Sheets
 * write read as false.
 */
describe("CSV cells are read against the property they are imported into", () => {

    const auth = {} as AuthController;
    const navigation = {
        getCollection: jest.fn().mockReturnValue(undefined)
    } as unknown as CollectionRegistryController;

    const properties: Properties = {
        sku: { type: "string" },
        version: { type: "string" },
        note: { type: "string" },
        active: { type: "boolean" },
        price: { type: "number" },
        status: { type: "string", enum: { draft: "Draft", live: "Live" } },
        tags: { type: "array", of: { type: "string" } },
        scores: { type: "array", of: { type: "number" } }
    };

    async function importCsv(csv: string, defaultValues: Record<string, unknown> = {}, idColumn?: string) {
        const file = new File([csv], "products.csv", { type: "text/csv" });
        const { data, propertiesOrder } = await convertFileToJson(file);
        const headersMapping = Object.fromEntries(propertiesOrder.map(h => [h, h]));
        return data.map(row => convertDataToEntity(auth, navigation, row as Record<string, unknown>,
            idColumn, headersMapping, properties, "products", defaultValues));
    }

    test("a string property keeps the cell's exact text", async () => {
        const [a, b] = await importCsv(
            "sku,version,note\r\n"
            + "12345678901234567890,1.10,null\r\n"
            + "00123,2.0,1E3\r\n");

        expect(a.values).toEqual({ sku: "12345678901234567890", version: "1.10", note: "null" });
        expect(b.values).toEqual({ sku: "00123", version: "2.0", note: "1E3" });
    });

    test("a string property keeps text that is also a number, a boolean or JSON", async () => {
        const [row] = await importCsv(
            "sku,version,note\r\n"
            + "123,true,\"[\"\"a\"\",\"\"b\"\"]\"\r\n");

        expect(row.values).toEqual({ sku: "123", version: "true", note: "[\"a\",\"b\"]" });
    });

    test("the id column keeps its exact text", async () => {
        const [row] = await importCsv("id,sku\r\n12345678901234567890,A\r\n", {}, "id");

        expect(row.id).toEqual("12345678901234567890");
    });

    test.each([
        ["TRUE", true], ["FALSE", false],
        ["true", true], ["false", false],
        ["Yes", true], ["no", false],
        ["1", true], ["0", false]
    ])("a boolean property reads %j as %j", async (cell, expected) => {
        const [row] = await importCsv(`sku,active\r\nA,${cell}\r\n`);

        expect(row.values).toEqual({ sku: "A", active: expected });
    });

    test("a blank cell is absent, so the default for it applies", async () => {
        const [row] = await importCsv("sku,price,status,tags\r\nA,,,\r\n",
            { price: 5, status: "draft", tags: ["x"] });

        expect(row.values).toEqual({ sku: "A", price: 5, status: "draft", tags: ["x"] });
    });

    test("a blank cell with no default sets nothing", async () => {
        const [row] = await importCsv("sku,price,status,tags,active\r\nA,,,,\r\n");

        expect(row.values).toEqual({ sku: "A" });
    });

    test("a list cell is split on commas and each item trimmed", async () => {
        const [row] = await importCsv("sku,tags,scores\r\nA,\"news, sports , ,tech\",\"1, 2,3\"\r\n");

        expect(row.values).toEqual({ sku: "A", tags: ["news", "sports", "tech"], scores: [1, 2, 3] });
    });

    test("a list cell holding a JSON array is read as the array", async () => {
        const [row] = await importCsv("sku,tags,scores\r\nA,\"[\"\"a, b\"\", \"\"c\"\"]\",\"[1, 2]\"\r\n");

        expect(row.values).toEqual({ sku: "A", tags: ["a, b", "c"], scores: [1, 2] });
    });

    test("a number property still reads a number cell", async () => {
        const [row] = await importCsv("sku,price\r\nA,12.50\r\n");

        expect(row.values).toEqual({ sku: "A", price: 12.5 });
    });

    test("a string property keeps a spreadsheet date as ISO text", () => {
        const date = new Date("2026-03-15T10:30:00.000Z");
        expect(processValueMapping(auth, date, navigation, { type: "string" })).toEqual("2026-03-15T10:30:00.000Z");
    });

    test("a string property keeps a JSON object cell as its text", async () => {
        const [row] = await importCsv("sku,note\r\nA,\"{\"\"a\"\":1}\"\r\n");

        expect(row.values).toEqual({ sku: "A", note: "{\"a\":1}" });
    });

    test("an unreadable boolean is absent rather than false", () => {
        expect(processValueMapping(auth, "maybe", navigation, { type: "boolean" })).toBeNull();
        expect(processValueMapping(auth, "  ", navigation, { type: "boolean" })).toBeNull();
    });
});
