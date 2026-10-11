/**
 * @jest-environment jsdom
 */
/**
 * A CSV export written a page at a time is the file the in-memory export
 * wrote, byte for byte.
 *
 * The export used to hold every entity, a processed copy of every row, an
 * array of cells per row and the row strings all at once — about 211 MB for
 * 100,000 rows × 20 columns. It now turns each page into CSV as it arrives.
 * The hard part is `flattenArrays`: the columns an array spreads into depend
 * on the longest array in any row, which the fixture only reaches late, so
 * rows written early have to be re-cut. The golden files were written by the
 * in-memory export before the change.
 */
import { describe, expect, jest, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { createCsvExportWriter, downloadEntitiesExport } from "../../src/data_export/export/export";
import {
    dottedKeyEntities,
    dottedKeyProperties,
    fixtureAdditional,
    fixtureAdditionalHeaders,
    fixtureEntities,
    fixtureProperties,
    fixturePropertiesOrder
} from "./csv_export_fixture";

const golden = (file: string) => fs.readFileSync(path.join(__dirname, "__fixtures__", file), "utf8");

const VARIANTS = [
    { file: "export_golden_flattened.csv", flattenArrays: true, dateExportType: "string" },
    { file: "export_golden_unflattened.csv", flattenArrays: false, dateExportType: "timestamp" }
] as const;

function pages<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

function writeInPages(pageSize: number, flattenArrays: boolean, dateExportType: "string" | "timestamp"): string {
    const writer = createCsvExportWriter({
        properties: fixtureProperties,
        propertiesOrder: fixturePropertiesOrder,
        additionalHeaders: fixtureAdditionalHeaders,
        flattenArrays,
        dateExportType
    });
    const entityPages = pages(fixtureEntities(), pageSize);
    const additionalPages = pages(fixtureAdditional(), pageSize);
    entityPages.forEach((page, i) => writer.addPage(page, additionalPages[i]));
    return writer.finish().join("");
}

describe("a streamed CSV export", () => {

    for (const { file, flattenArrays, dateExportType } of VARIANTS) {
        describe(`${flattenArrays ? "flattening" : "not flattening"} arrays`, () => {
            for (const pageSize of [1, 2, 3, 5, 12, 100]) {
                test(`in pages of ${pageSize}, writes the in-memory export's bytes`, () => {
                    jest.spyOn(console, "warn").mockImplementation(() => undefined);
                    expect(writeInPages(pageSize, flattenArrays, dateExportType)).toBe(golden(file));
                });
            }
        });
    }

    test("a key with a dot in it, spread, still writes the in-memory export's bytes", () => {
        for (const pageSize of [1, 2, 3]) {
            const writer = createCsvExportWriter({
                properties: dottedKeyProperties,
                propertiesOrder: undefined,
                additionalHeaders: undefined,
                flattenArrays: true,
                dateExportType: "string"
            });
            pages(dottedKeyEntities(), pageSize).forEach(page => writer.addPage(page));
            expect(writer.finish().join("")).toBe(golden("export_golden_dotted_key.csv"));
        }
    });

    test("with no rows, is the header row", () => {
        const writer = createCsvExportWriter({
            properties: { name: { type: "string" } },
            propertiesOrder: undefined,
            additionalHeaders: undefined,
            flattenArrays: true,
            dateExportType: "string"
        });
        writer.addPage([]);
        expect(writer.finish().join("")).toBe("\"id\",\"name\"\r\n");
    });

    test("downloadEntitiesExport writes the same file", async () => {
        jest.spyOn(console, "warn").mockImplementation(() => undefined);
        jest.spyOn(console, "debug").mockImplementation(() => undefined);
        let blob: Blob | undefined;
        const urls = URL as unknown as { createObjectURL: (b: Blob) => string, revokeObjectURL: () => void };
        urls.createObjectURL = (b: Blob) => {
            blob = b;
            return "blob:export";
        };
        urls.revokeObjectURL = () => undefined;
        downloadEntitiesExport({
            data: fixtureEntities(),
            additionalData: fixtureAdditional(),
            properties: fixtureProperties,
            propertiesOrder: fixturePropertiesOrder,
            name: "items",
            flattenArrays: true,
            additionalHeaders: fixtureAdditionalHeaders,
            exportType: "csv",
            dateExportType: "string"
        });
        const text = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsText(blob!);
        });
        expect(text).toBe(golden("export_golden_flattened.csv"));
    });
});
