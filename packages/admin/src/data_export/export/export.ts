import { Entity, EntityReference, Properties, Property } from "@rebasepro/types";
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
        const arrayValuesCount = flattenArrays ? getArrayValuesCount(data.map(d => d.values)) : {};
        const headers = getExportHeaders(properties, propertiesOrder, additionalHeaders, arrayValuesCount);
        const exportableData = getEntityCSVExportableData(data, additionalData, properties, headers, dateExportType);
        const headersData = entryToCSVRow(headers.map(h => h.label));
        const csvData = exportableData.map(entry => entryToCSVRow(entry));
        downloadBlob([headersData, ...csvData], `${name}.csv`, "text/csv");
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

    const mergedData: Record<string, unknown>[] = data.map(e => ({
        id: e.id,
        ...processValuesForExport(e.values, properties, "csv", dateExportType)
    }));

    if (additionalData) {
        additionalData.forEach((additional, index) => {
            mergedData[index] = { ...mergedData[index],
...additional };
        });
    }

    return mergedData && mergedData.map((entry) => {
        return headers.map((header) => getValueInPath(entry, header.key));
    });
}

export function getEntityJsonExportableData(data: Entity<Record<string, unknown>>[],
    additionalData: Record<string, unknown>[] | undefined,
    properties: Properties,
    dateExportType: "timestamp" | "string"
) {

    const mergedData: Record<string, unknown>[] = data.map(e => ({
        id: e.id,
        ...processValuesForExport(e.values, properties, "json", dateExportType)
    }));

    if (additionalData) {
        additionalData.forEach((additional, index) => {
            mergedData[index] = { ...mergedData[index],
...additional };
        });
    }

    return mergedData;
}

function getExportHeaders<M extends Record<string, unknown>>(properties: Properties,
    propertiesOrder: string[] | undefined,
    additionalHeaders: string[] | undefined,
    arrayValuesCount?: ArrayValuesCount): Header[] {

    const headers: Header[] = [
        {
            label: "id",
            key: "id"
        },
        ...(propertiesOrder ?? Object.keys(properties))
            .flatMap((childKey) => {
                const property = properties[childKey];
                if (!property) {
                    console.warn("Property not found", childKey, properties);
                    return [];
                }
                if (arrayValuesCount && arrayValuesCount[childKey] > 1) {
                    return Array.from({ length: arrayValuesCount[childKey] },
                        (_, i) => getHeaders(property as Property, `${childKey}[${i}]`, ""))
                        .flat();
                } else {
                    return getHeaders(property as Property, childKey, "");
                }
            })
    ];

    if (additionalHeaders) {
        headers.push(...additionalHeaders.map(h => ({
            label: h,
            key: h
        })));
    }

    return headers;
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

function processValueForExport(inputValue: unknown,
    property: Property,
    exportType: "csv" | "json",
    dateExportType: "timestamp" | "string"
): unknown {

    let value: unknown;
    if (property.type === "map" && property.properties) {
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
    const updatedValues = Object.entries(properties)
        .map(([key, property]) => {
            const inputValue = inputValues && (inputValues)[key];
            const updatedValue = processValueForExport(inputValue, property as Property, exportType, dateExportType);
            if (updatedValue === undefined) return {};
            return ({ [key]: updatedValue });
        })
        .reduce((a, b) => ({ ...a,
...b }), {}) as Record<string, unknown>;
    return { ...inputValues,
...updatedValues };
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

function toCSVCell(v: unknown): string {
    if (v === null || v === undefined) return "";
    const s = Array.isArray(v) ? JSON.stringify(v) : String(v);
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
}

export function downloadDataAsCsv(data: object[], name: string) {
    if (data.length === 0) return;

    const headers = Object.keys(data[0]);
    const csvContent = [
        headers.join(","),
        ...data.map(row => headers.map(header => toCSVCell((row as Record<string, unknown>)[header])).join(","))
    ].join("\r\n");

    downloadBlob([csvContent], `${name}.csv`, "text/csv");
}
