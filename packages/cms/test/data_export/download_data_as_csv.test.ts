/**
 * @jest-environment jsdom
 */
/**
 * `downloadDataAsCsv` writes its header row the way it writes every other
 * row, and a column for every key the rows hold.
 *
 * The header row was the keys joined with commas, unquoted: a key with a
 * comma in it split into two columns and pushed every cell after it one
 * column right, and a key a spreadsheet reads as a formula was written as
 * one. The columns were the first row's keys, so a key only later rows held
 * was left out of the file.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { downloadDataAsCsv } from "../../src/data_export/export/export";
import { parseCsvRows } from "../../src/data_import/utils/csv";

describe("downloadDataAsCsv", () => {

    let parts: BlobPart[] = [];

    beforeEach(() => {
        parts = [];
        const OriginalBlob = Blob;
        jest.spyOn(globalThis, "Blob").mockImplementation((content?: BlobPart[], options?: BlobPropertyBag) => {
            parts = content ?? [];
            return new OriginalBlob(content, options);
        });
        Object.assign(URL, { createObjectURL: () => "blob:csv", revokeObjectURL: () => undefined });
        jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    const written = () => parseCsvRows(parts.join(""));

    test("quotes a header that holds a comma", () => {
        downloadDataAsCsv([{ "city, state": "Austin, TX", count: 3 }], "file");
        expect(written()[0]).toEqual(["city, state", "count"]);
        expect(written()[1]).toEqual(["Austin, TX", "3"]);
    });

    test("does not write a header a spreadsheet would run", () => {
        downloadDataAsCsv([{ "=SUM(A1)": 1 }], "file");
        expect(written()[0]).toEqual(["'=SUM(A1)"]);
    });

    test("has a column for a key only a later row holds", () => {
        downloadDataAsCsv([{ a: 1 }, { a: 2, b: 3 }], "file");
        const rows = written();
        expect(rows[0]).toEqual(["a", "b"]);
        expect(rows[1]).toEqual(["1", ""]);
        expect(rows[2]).toEqual(["2", "3"]);
    });
});
