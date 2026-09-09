import { getWorksheetHeaders, type SheetCell } from "./file_headers";
import { mapJsonParse, unflattenObject } from "./transforms";
import { parseCsvToObjects } from "./csv";
import { isPrototypePollutingKey } from "@rebasepro/utils";

type ConversionResult = {
    data: object[];
    propertiesOrder: string[]
}

/**
 * The workbook reader, fetched the first time somebody actually opens one.
 *
 * Still lazy, and for the original reason: a top-level import put the whole
 * spreadsheet reader into the admin's entry chunk — preloaded on the login
 * screen, before anyone has authenticated, let alone clicked Import.
 * `CollectionViewActions` lazy-loads the import and export actions and says so
 * in a comment, but the package's own barrel (`src/index.ts` re-exports
 * `./data_import`) puts this module back in the entry's static graph, so the
 * `lazy()` bought nothing. A static import inside a module the barrel reaches
 * is eager no matter what the component above it does; the only thing that
 * makes a dependency lazy is importing it lazily, here.
 *
 * `read-excel-file` rather than `exceljs`, since 2026-09-09. exceljs is pinned
 * at its last release and carries six deprecated packages of its own —
 * `fstream`, `glob@7`, `inflight`, `lodash.isequal`, `rimraf@2`, `uuid@8` —
 * which every project that installed the admin inherited and pnpm warned about
 * on a first `init`. Nothing here ever *wrote* a workbook: this is the one
 * place that touched it, to read an uploaded file. A reader with no deprecated
 * tail does the same job.
 *
 * exceljs remains a devDependency, because the test writes real workbooks to
 * read back — a fixture built by the library under test proves nothing.
 */
/**
 * The default export returns one entry per *sheet*, not the rows — `readSheet`
 * is the rows-only overload. Taking `[0].data` keeps the old behaviour exactly:
 * ExcelJS read `workbook.worksheets[0]` and errored when there was none.
 */
type SheetEntry = { sheet: string; data: SheetCell[][] };
type ReadXlsxFile = (input: File | Blob | ArrayBuffer) => Promise<SheetEntry[]>;

let xlsxReader: Promise<ReadXlsxFile> | undefined;

function loadXlsxReader(): Promise<ReadXlsxFile> {
    // `/browser`, not the bare package name: `read-excel-file` publishes no
    // root export at all — its `exports` map has only `./browser`,
    // `./universal`, `./node` and `./web-worker`, so importing the package
    // itself is a resolution error rather than a default. The browser entry is
    // the one whose `Input` accepts an `ArrayBuffer`, which is what the
    // FileReader above produces.
    xlsxReader ??= import("read-excel-file/browser").then(mod => {
        const candidate = (mod as { default?: unknown }).default ?? mod;
        // `default.default` under some interop paths — unwrap one more level
        // rather than calling a namespace object and failing at the moment a
        // user picks a file, which is the only moment this code runs.
        const fn = typeof candidate === "function"
            ? candidate
            : (candidate as { default?: unknown })?.default;
        if (typeof fn !== "function") throw new Error("read-excel-file did not resolve to a function");
        return fn as ReadXlsxFile;
    });
    return xlsxReader;
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
                    const readXlsxFile = await loadXlsxReader();
                    // Every .xlsx is a zip, and its first two bytes say so. A
                    // file that is not one never reaches the reader, because
                    // what the reader says about it is a stack trace from
                    // inside its own unzipper — the shape of error the CSV
                    // branch above exists to avoid.
                    const magic = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength));
                    if (magic[0] !== 0x50 || magic[1] !== 0x4b) {
                        reject(new Error(
                            `'${file.name}' is not a readable .xlsx workbook. `
                            + "Export it again as .xlsx, or save it as .csv."
                        ));
                        return;
                    }

                    let sheets: SheetEntry[];
                    try {
                        sheets = await readXlsxFile(buffer);
                    } catch (readError) {
                        // A workbook with zero sheets throws from inside the
                        // reader (`readFiles(...).then is not a function`)
                        // rather than returning an empty list, so the "no
                        // sheets" case arrives here rather than below. The file
                        // is a valid zip — checked above — so the honest reading
                        // is that there is nothing in it to import.
                        console.debug("Spreadsheet reader failed", readError);
                        reject(new Error(
                            "No worksheets found in file — it has no sheets, or none this reader can open."
                        ));
                        return;
                    }

                    const firstSheet = sheets[0];
                    if (!firstSheet) {
                        reject(new Error("No worksheets found in file"));
                        return;
                    }

                    const [headerRow, ...dataRows] = firstSheet.data;
                    if (!headerRow) {
                        reject(new Error("The spreadsheet is empty"));
                        return;
                    }

                    const headers = getWorksheetHeaders(headerRow);
                    if (headers.order.length === 0) {
                        reject(new Error("The spreadsheet has no column headers in its first row"));
                        return;
                    }

                    const parsedData: Array<Record<string, any>> = [];
                    for (const row of dataRows) {
                        // A wholly empty row is not a record. ExcelJS skipped
                        // these with `includeEmpty: false`; here they arrive as
                        // a row of nulls.
                        if (row.every(cell => cell === null || cell === undefined)) continue;

                        const obj: Record<string, any> = {};
                        row.forEach((cell, index) => {
                            // An empty cell contributes no key, as before — the
                            // difference between "blank" and "absent" is what
                            // the import's own defaults key off.
                            if (cell === null || cell === undefined) return;
                            const header = headers.byColumn.get(index);
                            // A `__proto__` header would be the prototype setter
                            // here rather than a column; refused, as in `csv.ts`.
                            if (header && !isPrototypePollutingKey(header)) {
                                obj[header] = cell;
                            }
                        });
                        parsedData.push(obj);
                    }

                    resolve({
                        data: toImportRows(parsedData),
                        propertiesOrder: headers.order
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
