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

    async function workbookFile(rows: Array<Array<string | number>>): Promise<File> {
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

    test("rejects a workbook with no sheets", async () => {
        const workbook = new ExcelJS.Workbook();
        const buffer = await workbook.xlsx.writeBuffer();
        const file = new File([buffer as ArrayBuffer], "empty.xlsx", { type: "application/vnd.ms-excel" });

        await expect(convertFileToJson(file)).rejects.toThrow(/no worksheets/i);
    });
});
