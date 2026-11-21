import type { ArrayProperty, Properties, Property } from "@rebasepro/cms-types";

/**
 * A JSON document — an object or a list — in the one line a table cell or a
 * card has room for.
 *
 * A JSON column drawn in full is a tree: every nested object a bordered
 * sub-table, every array index a row, down to the coordinates of a polygon
 * (`trip › map › geo › 0 › rings › 0 › 0 › 107.97`). In a cell that is a wall,
 * clipped. The one-liner is shallow instead: the document's top-level keys,
 * labelled, each with its value when the value is short and plain, `n items`
 * for a list and `n fields` for an object, which are not opened.
 */

/** How many keys a summary names before it stops; the line truncates anyway. */
export const DOCUMENT_SUMMARY_ENTRIES = 4;

/** A text value longer than this is cut, so one long field does not take the line. */
const MAX_TEXT_LENGTH = 40;

/** One labelled entry of a summary. */
export type DocumentSummaryPart =
    | { label: string; kind: "text"; text: string }
    | { label: string; kind: "boolean"; value: boolean }
    | { label: string; kind: "items"; count: number }
    | { label: string; kind: "fields"; count: number };

/** The whole summary: the parts it names, or a count when the value is a bare list. */
export type DocumentSummary =
    | { kind: "parts"; parts: DocumentSummaryPart[] }
    | { kind: "items"; count: number }
    | { kind: "empty" };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function shorten(text: string): string {
    const line = text.replace(/\s+/g, " ").trim();
    return line.length > MAX_TEXT_LENGTH ? line.slice(0, MAX_TEXT_LENGTH - 1).trimEnd() + "…" : line;
}

function part(label: string, value: unknown): DocumentSummaryPart | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    if (Array.isArray(value)) return { label, kind: "items", count: value.length };
    if (value instanceof Date) return { label, kind: "text", text: value.toISOString().slice(0, 10) };
    if (isRecord(value)) return { label, kind: "fields", count: Object.keys(value).length };
    if (typeof value === "boolean") return { label, kind: "boolean", value };
    if (typeof value === "string") return { label, kind: "text", text: shorten(value) };
    if (typeof value === "number" || typeof value === "bigint") return { label, kind: "text", text: String(value) };
    return undefined;
}

/** What a summary knows about the document besides its value. */
export interface DocumentSummaryOptions {
    /** The declared sub-properties: a key is labelled with its property's name. */
    properties?: Properties;
    /** The declared order of the keys; keys it leaves out follow. */
    order?: string[];
    /** The only keys to name, in this order: a map field's `previewFields`. */
    keys?: string[];
    /** How many keys to name at most. */
    maxEntries?: number;
}

/**
 * The keys a summary reads, in order: the declared ones in their declared
 * order, then whatever else the value holds; or only `keys`, when given.
 */
function orderedKeys(value: Record<string, unknown>, { properties, order, keys }: DocumentSummaryOptions): string[] {
    if (keys && keys.length > 0) return keys;
    const first = order ?? (properties ? Object.keys(properties) : []);
    const seen = new Set(first);
    return [...first, ...Object.keys(value).filter(key => !seen.has(key))];
}

/**
 * The one-line summary of a document. A declared key is labelled with its
 * property's name; an undeclared key is labelled by itself.
 */
export function summarizeDocument(value: unknown, options: DocumentSummaryOptions = {}): DocumentSummary {
    if (Array.isArray(value)) return { kind: "items", count: value.length };
    if (!isRecord(value)) return { kind: "empty" };

    const maxEntries = options.maxEntries ?? DOCUMENT_SUMMARY_ENTRIES;
    const parts: DocumentSummaryPart[] = [];
    for (const key of orderedKeys(value, options)) {
        if (parts.length >= maxEntries) break;
        const label = options.properties?.[key]?.name || key;
        const entry = part(label, value[key]);
        if (entry) parts.push(entry);
    }
    return parts.length > 0 ? { kind: "parts", parts } : { kind: "empty" };
}

/**
 * True for a property whose value is a JSON document the full preview draws
 * as a block: an object, or a list of objects, lists or typed blocks. A table
 * cell draws these as their one-line summary.
 */
export function isDocumentProperty(property: Property): boolean {
    if (property.type === "map") return true;
    if (property.type !== "array") return false;
    const array = property as ArrayProperty;
    if (array.oneOf) return true;
    if (!array.of || Array.isArray(array.of)) return Boolean(array.of);
    const of = array.of as Property;
    return of.type === "map" || of.type === "array";
}
