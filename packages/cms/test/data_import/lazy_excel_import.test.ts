/**
 * @jest-environment jsdom
 */
import { describe, expect, test } from "@jest/globals";
import ExcelJS from "exceljs";

import { convertFileToJson } from "../../src/data_import/utils/file_to_json";

/**
 * That the workbook reader still works now that it is fetched, not imported.
 *
 * `file_to_json.ts` opened with `import ExcelJS from "exceljs"`, which put
 * 940 kB of spreadsheet reader in the admin's entry chunk — preloaded on the
 * login screen, and unaffected by the `lazy()` on the import action above it,
 * because the package barrel re-exports `./data_import` and reaches this
 * module statically. It is `await import("exceljs")` now.
 *
 * That swap has a failure mode nothing else here would catch: exceljs is
 * CommonJS, so what a dynamic import resolves to is an interop namespace whose
 * `default` holds the real module, and reading `.Workbook` off the wrong one
 * gives `undefined is not a constructor` — at the moment a user picks a file,
 * which is the only moment the code runs at all. Neither the type check nor
 * the build sees it. So this parses a real workbook end to end.
 */
describe("importing a spreadsheet with exceljs loaded on demand", () => {

    async function workbookFile(rows: Array<Array<string | number | Date>>): Promise<File> {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Sheet1");
        for (const row of rows) sheet.addRow(row);
        const buffer = await workbook.xlsx.writeBuffer();
        return new File(
            [buffer as ArrayBuffer],
            "products.xlsx",
            { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
        );
    }

    test("reads the header row and the rows under it", async () => {
        const file = await workbookFile([
            ["name", "price"],
            ["Chair", 40],
            ["Table", 120]
        ]);

        const { data, propertiesOrder } = await convertFileToJson(file);

        expect(propertiesOrder).toEqual(["name", "price"]);
        expect(data).toEqual([
            { name: "Chair", price: 40 },
            { name: "Table", price: 120 }
        ]);
    });

    test("a second import reuses the module rather than fetching it again", async () => {
        const first = await convertFileToJson(await workbookFile([["a"], ["1"]]));
        const second = await convertFileToJson(await workbookFile([["a"], ["2"]]));

        expect(first.data).toEqual([{ a: 1 }]);
        expect(second.data).toEqual([{ a: 2 }]);
    });

    test("rejects a file that is not a workbook at all, by name", async () => {
        // Not a zip, so never handed to the reader: what it says about a
        // non-workbook is a stack trace from inside its own unzipper. The
        // rename is the realistic way to get here — a .csv saved as .xlsx.
        const file = new File(["name,price\nWidget,9.5"], "renamed.xlsx", {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        });

        await expect(convertFileToJson(file)).rejects.toThrow(/not a readable \.xlsx workbook/i);
        await expect(convertFileToJson(file)).rejects.toThrow(/renamed\.xlsx/);
    });

    test("reads numbers and text back as themselves", async () => {
        // The reader swap changed which library produces these values, and the
        // import maps them by type — a number arriving as "9.5" would be a
        // string column in every imported row.
        const file = await workbookFile([["name", "price"], ["Widget", 9.5]]);
        const { data, propertiesOrder } = await convertFileToJson(file);

        expect(propertiesOrder).toEqual(["name", "price"]);
        expect(data).toEqual([{ name: "Widget", price: 9.5 }]);
        expect(typeof (data[0] as { price: unknown }).price).toBe("number");
    });

    /** Write `when` into a date column, import the workbook, return what came back. */
    async function importedDate(when: Date): Promise<Date> {
        const file = await workbookFile([["name", "when"], ["Launch", when]]);
        const { data } = await convertFileToJson(file);
        const value = (data[0] as { when: unknown }).when;
        if (!(value instanceof Date)) throw new Error(`the date column read back as ${typeof value}`);
        return value;
    }

    test("reads a date on a whole minute back on that minute", async () => {
        // Excel stores a date as a fractional count of days, and the reader
        // turns that into milliseconds with `Math.floor`. 12:30 is not exact in
        // floating point, so it arrived as 12:29:59.999 — and a field that
        // shows minutes displayed 12:29.
        const when = await importedDate(new Date("2024-03-01T12:30:00.000Z"));

        expect(when.toISOString()).toBe("2024-03-01T12:30:00.000Z");
    });

    test("keeps a genuine sub-second time rather than rounding it away", async () => {
        const when = await importedDate(new Date("2024-03-01T12:30:00.500Z"));

        expect(Math.abs(when.getTime() - Date.parse("2024-03-01T12:30:00.500Z"))).toBeLessThanOrEqual(1);
    });

    test("a blank header column does not shift the columns after it", async () => {
        // The ExcelJS version built a sparse array and compacted it with
        // `filter(Boolean)`, so a gap moved every later name one column left and
        // each value landed in its neighbour's field — silently, with the right
        // field names and the wrong values.
        const file = await workbookFile([
            ["name", "", "price"],
            ["Widget", "", 9.5]
        ]);
        const { data, propertiesOrder } = await convertFileToJson(file);

        expect(propertiesOrder).toEqual(["name", "price"]);
        expect(data).toEqual([{ name: "Widget", price: 9.5 }]);
    });

    test("rejects a workbook with no sheets", async () => {
        const workbook = new ExcelJS.Workbook();
        const buffer = await workbook.xlsx.writeBuffer();
        const file = new File([buffer as ArrayBuffer], "empty.xlsx", { type: "application/vnd.ms-excel" });

        await expect(convertFileToJson(file)).rejects.toThrow(/no worksheets/i);
    });
});
