import { getWorksheetHeaders } from "./file_headers";
import { mapJsonParse, unflattenObject } from "./transforms";
import { parseCsvToObjects } from "./csv";
import { isPrototypePollutingKey } from "@rebasepro/utils";

type ConversionResult = {
    data: object[];
    propertiesOrder: string[]
}

/**
 * ExcelJS, fetched the first time somebody actually opens a workbook.
 *
 * It was a top-level `import ExcelJS from "exceljs"`, and that one line put
 * 940 kB of spreadsheet reader into the admin's entry chunk — preloaded on the
 * login screen, before anyone has authenticated, let alone clicked Import.
 * `CollectionViewActions` lazy-loads the import and export actions and says so
 * in a comment, but the package's own barrel (`src/index.ts` re-exports
 * `./data_import`) puts this module back in the entry's static graph, so the
 * `lazy()` bought nothing. A static import inside a module the barrel reaches
 * is eager no matter what the component above it does; the only thing that
 * makes a dependency lazy is importing it lazily, here.
 */
type ExcelJsModule = typeof import("exceljs");

let excelJsModule: Promise<ExcelJsModule> | undefined;

function loadExcelJs(): Promise<ExcelJsModule> {
    // exceljs is CommonJS, so the namespace a bundler hands back wraps the real
    // module under `default`. Native ESM (and the type declarations) put the
    // members at the top level. Accept either.
    excelJsModule ??= import("exceljs").then(mod => (mod as { default?: ExcelJsModule }).default ?? mod);
    return excelJsModule;
}

/**
 * Whether this file is delimited text rather than a workbook.
 *
 * Browsers report `text/csv`, `application/csv` or nothing at all for the same
 * `.csv`, so the extension is the reliable half of the test.
 */
function isCsvFile(file: File): boolean {
    const name = (file.name ?? "").toLowerCase();
    if (name.endsWith(".csv") || name.endsWith(".tsv")) return true;
    return file.type === "text/csv" || file.type === "application/csv";
}

/** Turn the parsed cells of one sheet/file into the entity-shaped rows the import maps. */
function toImportRows(rows: Array<Record<string, unknown>>): object[] {
    return rows.map(mapJsonParse).map(unflattenObject);
}

export function convertFileToJson(file: File): Promise<ConversionResult> {
    return new Promise((resolve, reject) => {
        if (isCsvFile(file)) {
            // Not the ExcelJS branch: `workbook.xlsx.load` is a zip reader, and
            // every CSV — the format this admin exports by default — died on it
            // with "Can't find end of central directory : is this a zip file ?".
            console.debug("Converting CSV file to JSON", file.name);
            const reader = new FileReader();
            reader.onload = function (e) {
                try {
                    const { headers, data } = parseCsvToObjects(e.target?.result as string);
                    if (headers.length === 0) {
                        reject(new Error("The CSV file is empty"));
                        return;
                    }
                    resolve({
                        data: toImportRows(data),
                        propertiesOrder: headers
                    });
                } catch (err) {
                    console.error("Error parsing CSV file", err);
                    reject(err);
                }
            };
            reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
            // Explicit UTF-8: the pre-ExcelJS implementation passed
            // `codepage: 65001` for the same reason, and the browser's default
            // guess mangles accented and CJK text.
            reader.readAsText(file, "utf-8");
        } else if (file.type === "application/json") {
            console.debug("Converting JSON file to JSON", file.name);
            const reader = new FileReader();
            reader.onload = function (e) {
                try {
                    const data = e.target?.result as string;
                    const jsonData = JSON.parse(data);
                    if (!Array.isArray(jsonData)) {
                        reject(new Error("JSON file should contain an array of objects"));
                    } else {
                        const propertiesOrder = jsonData.length > 0 ? Object.keys(jsonData[0]) : [];
                        resolve({
                            data: jsonData,
                            propertiesOrder
                        });
                    }
                } catch (e) {
                    console.error("Error parsing JSON file", e);
                    reject(e);
                }
            };
            reader.readAsText(file);
        } else {
            console.debug("Converting Excel file to JSON", file.name);
            const reader = new FileReader();
            reader.onload = async function (e) {
                try {
                    const buffer = e.target?.result as ArrayBuffer;
                    const ExcelJS = await loadExcelJs();
                    const workbook = new ExcelJS.Workbook();
                    await workbook.xlsx.load(buffer);
                    const worksheet = workbook.worksheets[0];
                    if (!worksheet) {
                        reject(new Error("No worksheets found in file"));
                        return;
                    }

                    const headers = getWorksheetHeaders(worksheet);

                    // Convert rows to JSON objects (skip header row)
                    const parsedData: Array<Record<string, any>> = [];
                    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
                        if (rowNumber === 1) return;
                        const obj: Record<string, any> = {};
                        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
                            const header = headers[colNumber - 1];
                            // A `__proto__` header would be the prototype setter
                            // here rather than a column; refused, as in `csv.ts`.
                            if (header && !isPrototypePollutingKey(header)) {
                                obj[header] = cell.value;
                            }
                        });
                        parsedData.push(obj);
                    });

                    resolve({
                        data: toImportRows(parsedData),
                        propertiesOrder: headers
                    });
                } catch (err) {
                    console.error("Error parsing Excel file", err);
                    reject(err);
                }
            };
            reader.readAsArrayBuffer(file);
        }
    });
}
