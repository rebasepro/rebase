import { Entity, EntityReference, EntityRelation, Properties, Property } from "@rebasepro/types";
import { type ArrayValuesCount, getArrayValuesCount, getValueInPath } from "@rebasepro/utils";

interface Header {
    key: string;
    label: string;
}

export interface DownloadEntitiesExportParams<M extends Record<string, unknown>> {
    data: Entity<M>[];
    additionalData: Record<string, unknown>[] | undefined;
    properties: Properties;
    propertiesOrder: string[] | undefined;
    name: string;
    flattenArrays: boolean;
    additionalHeaders: string[] | undefined;
    exportType: "csv" | "json";
    dateExportType: "timestamp" | "string";
}

export function downloadEntitiesExport<M extends Record<string, unknown>>({
    data,
    additionalData,
    properties,
    propertiesOrder,
    name,
    flattenArrays,
    additionalHeaders,
    exportType,
    dateExportType
}: DownloadEntitiesExportParams<M>
) {

    console.debug("Downloading export", {
        dataLength: data.length,
        properties,
        exportType,
        dateExportType
    });

    if (exportType === "csv") {
        const writer = createCsvExportWriter({
            properties,
            propertiesOrder,
            additionalHeaders,
            flattenArrays,
            dateExportType
        });
        writer.addPage(data, additionalData);
        downloadBlob(writer.finish(), `${name}.csv`, "text/csv");
    } else {
        const exportableData = getEntityJsonExportableData(data, additionalData, properties, dateExportType);
        const json = JSON.stringify(exportableData, null, 2);
        downloadBlob([json], `${name}.json`, "application/json");
    }
}

export function getEntityCSVExportableData(data: Entity<Record<string, unknown>>[],
    additionalData: Record<string, unknown>[] | undefined,
    properties: Properties,
    headers: Header[],
    dateExportType: "timestamp" | "string"
) {
    return mergeExportRows(data, additionalData, properties, "csv", dateExportType)
        .map((entry) => headers.map((header) => getValueInPath(entry, header.key)));
}

export function getEntityJsonExportableData(data: Entity<Record<string, unknown>>[],
    additionalData: Record<string, unknown>[] | undefined,
    properties: Properties,
    dateExportType: "timestamp" | "string"
) {
    return mergeExportRows(data, additionalData, properties, "json", dateExportType);
}

/**
 * Each entity as the record its export row is read from: `id`, the processed
 * values, then `additionalData[i]` over them. An `additionalData` longer than
 * `data` adds rows of its own.
 */
function mergeExportRows(data: Entity<Record<string, unknown>>[],
    additionalData: Record<string, unknown>[] | undefined,
    properties: Properties,
    exportType: "csv" | "json",
    dateExportType: "timestamp" | "string"
): Record<string, unknown>[] {

    const mergedData: Record<string, unknown>[] = data.map(e => ({
        id: e.id,
        ...processValuesForExport(e.values, properties, exportType, dateExportType)
    }));

    if (additionalData) {
        additionalData.forEach((additional, index) => {
            mergedData[index] = { ...mergedData[index],
...additional };
        });
    }

    return mergedData;
}

/**
 * The columns of an export, in groups: the `id`, then one group per property
 * in `propertiesOrder`, then one per additional header. A property's group is
 * the one that becomes a column per array item (`tags[0]`, `tags[1]`, …) when
 * arrays are flattened and some row holds more than one.
 */
interface ExportHeaderGroup {
    /** The property's key, for a property's group. */
    key?: string;
    property?: Property;
    /** The group's columns while its array is not expanded. */
    headers: Header[];
}

function getExportHeaderGroups(properties: Properties,
    propertiesOrder: string[] | undefined,
    additionalHeaders: string[] | undefined): ExportHeaderGroup[] {

    const groups: ExportHeaderGroup[] = [{ headers: [{ label: "id", key: "id" }] }];
    for (const childKey of propertiesOrder ?? Object.keys(properties)) {
        // The first column already is the id. A collection that declares its
        // key as a property named `id` wrote it twice, and the import refuses
        // a file with a duplicate header.
        if (childKey === "id") continue;
        const property = properties[childKey];
        if (!property) {
            console.warn("Property not found", childKey, properties);
            continue;
        }
        groups.push({ key: childKey, property: property as Property, headers: getHeaders(property as Property, childKey, "") });
    }
    if (additionalHeaders) {
        groups.push(...additionalHeaders.map(h => ({ headers: [{ label: h, key: h }] })));
    }
    return groups;
}

/** How many columns per item the group's array spreads into, or 0 when it does not. */
function expandedItemCount(group: ExportHeaderGroup, arrayValuesCount: ArrayValuesCount): number {
    if (group.key === undefined) return 0;
    const count = arrayValuesCount[group.key];
    return count > 1 ? count : 0;
}

/** The group's columns for array item `index`. */
function itemHeaders(group: ExportHeaderGroup, index: number): Header[] {
    return getHeaders(group.property as Property, `${group.key}[${index}]`, "");
}

function headersOf(groups: ExportHeaderGroup[], arrayValuesCount: ArrayValuesCount): Header[] {
    return groups.flatMap((group) => {
        const count = expandedItemCount(group, arrayValuesCount);
        return count > 0
            ? Array.from({ length: count }, (_, i) => itemHeaders(group, i)).flat()
            : group.headers;
    });
}

function rowCells(entry: Record<string, unknown>, headers: Header[]): string[] {
    return headers.map((header) => toCSVCell(getValueInPath(entry, header.key)));
}

export interface CsvExportWriterParams {
    properties: Properties;
    propertiesOrder: string[] | undefined;
    additionalHeaders: string[] | undefined;
    flattenArrays: boolean;
    dateExportType: "timestamp" | "string";
}

/**
 * Writes a CSV export one page of entities at a time.
 *
 * An export used to hold every entity it read, then a copy of every row, then
 * an array of cells per row, then the row strings — about 211 MB at its peak
 * for 100,000 rows × 20 columns, for a 32 MB file. Each page is now turned
 * into its CSV text as it arrives and its entities are let go; what is held
 * is the text itself.
 *
 * The file is the one the in-memory export wrote, byte for byte. What makes
 * that work across pages is `flattenArrays`: the columns an array spreads into
 * (`tags[0]` … `tags[n-1]`) depend on the longest array in *any* row, which
 * an early page cannot know. So a page is written with the columns known when
 * it arrives, and a row also keeps the cells of any array items those columns
 * leave out. At the end, a page written with fewer columns than the file has
 * is re-cut: its cells copied, and an array's swapped for, or extended with,
 * the kept item cells (or empty ones). Usually the longest array is met in the
 * first page and nothing is re-cut. A property key with `.` or `[` in it
 * resolves through other properties when spread, so an export with one keeps
 * its rows' records and writes them at the end, as before.
 */
export interface CsvExportWriter {
    /** One page of entities, with their additional-column values index for index. */
    addPage(data: Entity<Record<string, unknown>>[], additionalData?: Record<string, unknown>[]): void;
    /** The whole file, header row first. Once: the pages are handed over. */
    finish(): BlobPart[];
}

/**
 * A row's cells for the items of one array that its page's columns leave out,
 * kept in case the file has columns for them. The cells of items `0…n-1` in
 * one string, for an array its page did not spread; otherwise one string per
 * item, a hole where an item is not kept or its cells are all empty.
 */
type RowItemCells = string | (string | undefined)[];

interface CsvExportPage {
    /** The rows, `\r\n` after each. */
    text: string;
    rows: number;
    /** Per group, the items its array was spread into on this page; 0 when not spread. */
    spread: number[];
    /** By `row * groups + group`, for the rows that hold items `spread` leaves out. */
    items?: (RowItemCells | undefined)[];
    /** The rows' records, when the export cannot be re-cut (see the writer). */
    entries?: Record<string, unknown>[];
}

export function createCsvExportWriter({
    properties,
    propertiesOrder,
    additionalHeaders,
    flattenArrays,
    dateExportType
}: CsvExportWriterParams): CsvExportWriter {

    const groups = getExportHeaderGroups(properties, propertiesOrder, additionalHeaders);
    // The columns of item `i` of each group, built once per item, not per row.
    const itemHeaderCache: Header[][][] = groups.map(() => []);
    const headersOfItem = (groupIndex: number, index: number): Header[] =>
        itemHeaderCache[groupIndex][index] ??= itemHeaders(groups[groupIndex], index);
    // Cells per item; a group with none (a map with no properties) spreads
    // into no columns at all.
    const itemWidths = groups.map((group, groupIndex) => group.key === undefined ? 0 : headersOfItem(groupIndex, 0).length);
    const arrayValuesCount: ArrayValuesCount = {};
    // A key the spread column's path would read through some other property.
    const keepEntries = flattenArrays && groups.some((group) => group.key !== undefined && /[.[\]]/.test(group.key));
    const pages: CsvExportPage[] = [];

    return {
        addPage(data, additionalData) {
            if (flattenArrays) {
                // Merged by maximum, which is what one pass over every row
                // computes.
                for (const [key, count] of Object.entries(getArrayValuesCount(data.map(d => d.values)))) {
                    arrayValuesCount[key] = Math.max(arrayValuesCount[key] || 0, count);
                }
            }
            const spread = groups.map((group) => expandedItemCount(group, arrayValuesCount));
            const entries = mergeExportRows(data, additionalData, properties, "csv", dateExportType);
            if (keepEntries) {
                pages.push({ text: "", rows: entries.length, spread, entries });
                return;
            }
            const headers = headersOf(groups, arrayValuesCount);
            const lines: string[] = [];
            let items: CsvExportPage["items"];
            entries.forEach((entry, row) => {
                lines.push(rowCells(entry, headers).join(",") + "\r\n");
                if (!flattenArrays) return;
                const bracketed = bracketedKeyIndices(entry);
                groups.forEach((group, groupIndex) => {
                    if (group.key === undefined || itemWidths[groupIndex] === 0) return;
                    const written = spread[groupIndex];
                    const indices = itemIndicesWithValues(entry, group.key, bracketed)
                        .filter((index) => index >= written);
                    if (indices.length === 0) return;
                    const value = entry[group.key];
                    let cells: RowItemCells;
                    if (written === 0 && Array.isArray(value) && indices.length === value.length) {
                        cells = value.map((_, index) => rowCells(entry, headersOfItem(groupIndex, index)).join(",")).join(",");
                    } else {
                        cells = [];
                        for (const index of indices) {
                            cells[index] = rowCells(entry, headersOfItem(groupIndex, index)).join(",");
                        }
                    }
                    (items ??= [])[row * groups.length + groupIndex] = cells;
                });
            });
            pages.push({ text: lines.join(""), rows: entries.length, spread, items });
        },

        finish() {
            const counts = flattenArrays ? arrayValuesCount : {};
            const headers = headersOf(groups, counts);
            const parts: BlobPart[] = [entryToCSVRow(headers.map(h => h.label))];
            const spread = groups.map((group) => expandedItemCount(group, counts));

            // Handed over a page at a time, so a re-cut page and the text it
            // was cut from are not both held for the whole file.
            for (let page = pages.shift(); page; page = pages.shift()) {
                if (page.entries) {
                    parts.push(page.entries.map((entry) => rowCells(entry, headers).join(",") + "\r\n").join(""));
                } else if (page.spread.every((count, groupIndex) => count === spread[groupIndex])) {
                    parts.push(page.text);
                } else {
                    parts.push(recutPage(page, groups, spread, itemWidths));
                }
            }
            return parts;
        }
    };
}

/**
 * The record's own keys spelled `key[i]…`, by `key`: `getValueInPath` reads
 * one of those for the cell `key[i]` before anything else. Almost never there.
 */
function bracketedKeyIndices(entry: Record<string, unknown>): Map<string, number[]> | undefined {
    let found: Map<string, number[]> | undefined;
    for (const own of Object.keys(entry)) {
        if (!own.includes("[")) continue;
        const match = /^(.*?)\[(\d+)\]/.exec(own);
        if (!match) continue;
        found ??= new Map();
        const indices = found.get(match[1]) ?? [];
        indices.push(Number(match[2]));
        found.set(match[1], indices);
    }
    return found;
}

const NO_INDICES: number[] = [];

/**
 * The array items of `entry[key]` whose spread cells may not all be empty —
 * every other item's are, as `getValueInPath` reads `key[i]` and
 * `key[i].child`: an array's own items, an object's own integer-named keys
 * (read as `key[i]` too), and a key of the record spelled `key[i]…` itself.
 * Over-including is harmless; the cells are computed, not assumed.
 */
function itemIndicesWithValues(entry: Record<string, unknown>,
    key: string,
    bracketed: Map<string, number[]> | undefined): number[] {
    const value = entry[key];
    const extra = bracketed?.get(key);
    if (!extra) {
        // The common cases, without building a set per cell.
        if (Array.isArray(value)) return value.map((_, i) => i);
        if (value === null || typeof value !== "object") return NO_INDICES;
    }
    const indices = new Set<number>();
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) indices.add(i);
    } else if (value !== null && typeof value === "object") {
        for (const own of Object.getOwnPropertyNames(value)) {
            const match = /^(\d+)(?:$|[.[])/.exec(own);
            if (match) indices.add(Number(match[1]));
        }
    }
    extra?.forEach((index) => indices.add(index));
    return [...indices];
}

/**
 * A page written with fewer columns than the file has, cut back into cells
 * and written again: each array the file spreads further than the page did
 * gets its kept item cells, or empty ones.
 */
function recutPage(page: CsvExportPage, groups: ExportHeaderGroup[], spread: number[], itemWidths: number[]): string {
    const text = page.text;
    const out: string[] = [];
    let pos = 0;
    for (let row = 0; row < page.rows; row++) {
        const cells: string[] = [];
        let first = true;
        groups.forEach((group, groupIndex) => {
            const written = page.spread[groupIndex];
            const itemWidth = itemWidths[groupIndex];
            const width = written > 0 ? written * itemWidth : group.headers.length;
            const groupCells: string[] = [];
            for (let c = 0; c < width; c++) {
                if (!first) pos++; // the comma before every cell but the row's first
                first = false;
                const end = csvCellEnd(text, pos);
                groupCells.push(text.slice(pos, end));
                pos = end;
            }
            const count = spread[groupIndex];
            if (count === written) {
                cells.push(...groupCells);
                return;
            }
            // Spread further than the page was: the items it wrote stay.
            if (written > 0) cells.push(...groupCells);
            const items = page.items?.[row * groups.length + groupIndex];
            const dense = typeof items === "string" ? splitCsvCells(items) : undefined;
            for (let i = written; i < count; i++) {
                const itemCells = dense
                    ? dense.slice(i * itemWidth, (i + 1) * itemWidth)
                    : (typeof items === "object" && items[i] !== undefined ? splitCsvCells(items[i] as string) : []);
                for (let c = 0; c < itemWidth; c++) cells.push(itemCells[c] ?? "");
            }
        });
        pos += 2; // "\r\n"
        out.push(cells.join(",") + "\r\n");
    }
    return out.join("");
}

/** The cells of a run of them joined with commas, as `toCSVCell` wrote them. */
function splitCsvCells(text: string): string[] {
    const cells: string[] = [];
    let pos = 0;
    for (; ;) {
        const end = csvCellEnd(text, pos);
        cells.push(text.slice(pos, end));
        if (end >= text.length) return cells;
        pos = end + 1;
    }
}

/**
 * Where the cell starting at `start` ends. Every cell `toCSVCell` writes is
 * either empty or quoted with its own quotes doubled, so the next lone quote
 * closes it.
 */
function csvCellEnd(text: string, start: number): number {
    if (text.charCodeAt(start) !== 34 /* " */) return start;
    let i = start + 1;
    for (; ;) {
        const quote = text.indexOf("\"", i);
        if (quote < 0) return text.length;
        if (text.charCodeAt(quote + 1) === 34) {
            i = quote + 2;
        } else {
            return quote + 1;
        }
    }
}

/**
 * Get headers for property. There could be more than one header per property
 * @param property
 * @param propertyKey
 * @param prefix
 */
function getHeaders(property: Property, propertyKey: string, prefix = ""): Header[] {
    const currentKey = prefix ? `${prefix}.${propertyKey}` : propertyKey;
    if (property.type === "map" && property.properties) {
        return Object.entries(property.properties)
            .map(([childKey, p]) => getHeaders(p, childKey, currentKey))
            .flat();
    } else {
        return [{
            label: currentKey,
            key: currentKey
        }];
    }
}

/**
 * Read whatever a `date` column actually arrived as into a `Date`.
 *
 * The driver/WebSocket path revives `{ __type: "date" }` into a `Date`; the REST
 * path — which is the one the admin is on — leaves an ISO string, and an epoch
 * number is what a re-imported export carries. Returns `undefined` for anything
 * that is not a date, so the caller can pass the raw value through.
 */
function toExportableDate(inputValue: unknown): Date | undefined {
    if (inputValue instanceof Date) return Number.isNaN(inputValue.getTime()) ? undefined : inputValue;
    if (typeof inputValue === "number" && Number.isFinite(inputValue)) return new Date(inputValue);
    if (typeof inputValue === "string" && inputValue.trim() !== "") {
        const parsed = new Date(inputValue);
        return Number.isNaN(parsed.getTime()) ? undefined : parsed;
    }
    return undefined;
}

/**
 * The id a relation value points at, for a relation property's value — an
 * `EntityRelation`, or the same thing still in its `{ __type: "relation" }`
 * wire form. `undefined` for anything else, so a bare foreign key passes
 * through as the id it already is.
 */
function relationIdForExport(value: unknown): string | number | undefined {
    if (value instanceof EntityRelation) return value.id;
    if (typeof value === "object" && value !== null
        && "__type" in value && value.__type === "relation"
        && "id" in value && (typeof value.id === "string" || typeof value.id === "number")) {
        return value.id;
    }
    return undefined;
}

function processValueForExport(inputValue: unknown,
    property: Property,
    exportType: "csv" | "json",
    dateExportType: "timestamp" | "string"
): unknown {

    let value: unknown;
    if (property.type === "relation") {
        // A relation is exported as the id it points at — what the import
        // writes back — rather than the view-model object the admin holds,
        // which a CSV cell printed as `[object Object]`. To-many relations
        // are arrays of them.
        const toId = (item: unknown) => relationIdForExport(item) ?? item;
        value = Array.isArray(inputValue) ? inputValue.map(toId) : toId(inputValue);
    } else if (property.type === "map" && property.properties) {
        value = processValuesForExport(inputValue as Record<string, unknown>, property.properties as Properties, exportType, dateExportType);
    } else if (property.type === "array") {
        if (property.of && Array.isArray(inputValue)) {
            if (Array.isArray(property.of)) {
                value = property.of.map((p, i) => processValueForExport(inputValue[i], p, exportType, dateExportType));
            } else if (property.of.type === "map") {
                value = exportType === "csv"
                    ? inputValue.map((e) => JSON.stringify(e))
                    : inputValue.map((e) => processValueForExport(e, property.of as Property, exportType, dateExportType));
                ;
            } else {
                value = inputValue.map((e) => processValueForExport(e, property.of as Property, exportType, dateExportType));
            }
        } else {
            value = inputValue;
        }
    } else if (property.type === "reference" && inputValue && typeof inputValue === "object" && "isEntityReference" in inputValue && typeof (inputValue as EntityReference).isEntityReference === "function" && (inputValue as EntityReference).isEntityReference()) {
        const ref = inputValue ? inputValue as EntityReference : undefined;
        value = ref ? ref.fullPath : null;
    } else if (property.type === "date") {
        // Not `instanceof Date`: the admin reads over REST, and the REST row
        // pipeline hands dates back as the database wrote them — a string. That
        // made this branch dead on every live export, so both radio options
        // produced identical files. Normalise here, where the declared type says
        // the column is a date, and leave anything unparseable untouched rather
        // than exporting an invalid date as `null`.
        const date = toExportableDate(inputValue);
        value = date
            ? (dateExportType === "timestamp" ? date.getTime() : date.toISOString())
            : inputValue;
    } else {
        value = inputValue;
    }

    return value;
}

function processValuesForExport<M extends Record<string, unknown>>
    (inputValues: Record<string, unknown>,
        properties: Properties,
        exportType: "csv" | "json",
        dateExportType: "timestamp" | "string"
    ): Record<string, unknown> {
    // One accumulator. Merging `{ [key]: value }` objects pairwise copied the
    // whole row once per property — the square of the property count, per row.
    const result: Record<string, unknown> = { ...inputValues };
    for (const [key, property] of Object.entries(properties)) {
        const inputValue = inputValues && (inputValues)[key];
        const updatedValue = processValueForExport(inputValue, property as Property, exportType, dateExportType);
        if (updatedValue === undefined) continue;
        if (key === "__proto__") {
            // An own property, as the object spread made it, not the prototype.
            Object.defineProperty(result, key, { value: updatedValue, enumerable: true, writable: true, configurable: true });
        } else {
            result[key] = updatedValue;
        }
    }
    return result;
}

/**
 * Characters that make a spreadsheet read a cell as a formula rather than text.
 *
 * Quoting is CSV *escaping* and is not enough: Excel, LibreOffice Calc and
 * Sheets strip the CSV quoting at parse time and then evaluate a cell whose
 * first character is one of these — `=HYPERLINK(…)` exfiltrates neighbouring
 * cells on click, `=cmd|'…'!A0` is worse.
 */
const FORMULA_TRIGGERS = ["=", "+", "-", "@", "\t", "\r"];

/**
 * Neutralise a cell that a spreadsheet would otherwise evaluate, by prefixing a
 * single quote — the standard OWASP mitigation. The apostrophe is consumed by
 * the spreadsheet as "treat the rest as text", so the value reads back intact.
 */
export function escapeCsvFormula(value: string): string {
    const first = value.charAt(0);
    if (!FORMULA_TRIGGERS.includes(first)) return value;
    // A signed number is not a formula, and prefixing it would turn every
    // negative amount in the file into text. `-1+1` is still neutralised,
    // because it is not a number.
    if ((first === "-" || first === "+") && value.trim() !== "" && Number.isFinite(Number(value))) return value;
    return "'" + value;
}

/**
 * The inverse of {@link escapeCsvFormula}, for a file read back in: a cell that
 * is an apostrophe followed by a formula trigger loses the apostrophe, as it
 * does when a spreadsheet reads it. Any other apostrophe is text.
 */
export function unescapeCsvFormula(value: string): string {
    return value.charAt(0) === "'" && FORMULA_TRIGGERS.includes(value.charAt(1))
        ? value.slice(1)
        : value;
}

function toCSVCell(v: unknown): string {
    if (v === null || v === undefined) return "";
    // An array or object (a geopoint, a value no property declares) is written
    // as its JSON: `String()` of an object is `[object Object]`. Date
    // properties are normalised before they get here.
    const s = Array.isArray(v) || (typeof v === "object" && !(v instanceof Date))
        ? JSON.stringify(v)
        : String(v);
    return "\"" + escapeCsvFormula(s).replaceAll("\"", "\"\"") + "\"";
}

export function entryToCSVRow(entry: unknown[]) {
    return entry
        .map(toCSVCell)
        .join(",") + "\r\n";
}

export function downloadBlob(content: BlobPart[], filename: string, contentType: string) {
    const blob = new Blob(content, { type: contentType });
    const url = URL.createObjectURL(blob);
    const pom = document.createElement("a");
    pom.href = url;
    pom.setAttribute("download", filename);
    pom.click();
    // Unrevoked, the URL kept the whole file in memory until the tab closed —
    // one more copy per export. The download holds its own reference once it
    // has started; the delay covers browsers that start it a moment after
    // `click()` returns.
    setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_LIFETIME_MS);
}

/** How long an export's object URL outlives the click that downloads it. */
const BLOB_URL_LIFETIME_MS = 10_000;

export function downloadDataAsCsv(data: object[], name: string) {
    if (data.length === 0) return;

    const headers = Object.keys(data[0]);
    const csvContent = [
        headers.join(","),
        ...data.map(row => headers.map(header => toCSVCell((row as Record<string, unknown>)[header])).join(","))
    ].join("\r\n");

    downloadBlob([csvContent], `${name}.csv`, "text/csv");
}
