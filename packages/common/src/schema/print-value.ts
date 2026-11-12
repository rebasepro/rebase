import { array, object, printString, text } from "./print-doc";
import type { Doc } from "./print-doc";

/**
 * A definition the printer cannot turn into source without losing something:
 * a hook whose source was not supplied, a value that is not data, a column
 * shape no builder chain produces.
 *
 * The printer never drops what it cannot print — it refuses, naming where the
 * value sits and what to supply instead.
 *
 * @group Schema
 */
export class TablePrintError extends Error {

    readonly code = "TABLE_PRINT_UNPRINTABLE";

    constructor(
        /** Where the value sits: `posts.columns.title`, `posts.hooks.beforeSave`. */
        readonly path: string,
        message: string
    ) {
        super(`Cannot print ${path}: ${message}`);
        this.name = "TablePrintError";
    }
}

const isPlainObject = (value: object): boolean => {
    const proto: unknown = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
};

/** A number literal, including the values JSON has no spelling for. */
export function printNumber(value: number): string {
    if (Object.is(value, -0)) return "-0";
    if (Number.isNaN(value)) return "NaN";
    if (value === Infinity) return "Infinity";
    if (value === -Infinity) return "-Infinity";
    return String(value);
}

/**
 * A data value as a source literal: strings, numbers, booleans, `null`,
 * `bigint`, regular expressions, arrays and plain objects (keys in their own
 * order, `undefined` members left out as `JSON.stringify` leaves them out).
 *
 * Anything else — a function, a class instance, a `Date`, a symbol — has no
 * faithful literal and is refused with its path.
 *
 * @param path Where the value sits, for the refusal.
 */
export function valueDoc(value: unknown, path: string): Doc {
    switch (typeof value) {
        case "string":
            return text(printString(value));
        case "number":
            return text(printNumber(value));
        case "boolean":
            return text(String(value));
        case "bigint":
            return text(`${value.toString()}n`);
        case "undefined":
            return text("undefined");
        case "function":
            throw new TablePrintError(path, "it is a function, which is code rather than data. Supply its source text instead.");
        case "symbol":
            throw new TablePrintError(path, "it is a symbol, which has no source literal.");
        case "object":
            break;
    }
    if (value === null) return text("null");
    if (value instanceof RegExp) return text(String(value));
    if (Array.isArray(value)) {
        const items: Doc[] = [];
        value.forEach((item: unknown, index) => items.push(valueDoc(item, `${path}[${index}]`)));
        return array(items);
    }
    if (!isPlainObject(value)) {
        const name = value.constructor?.name ?? "object";
        throw new TablePrintError(path, `it is a \`${name}\` instance, which has no source literal. Pass plain data (strings, numbers, arrays, objects).`);
    }
    const entries: [string, Doc][] = [];
    for (const [key, member] of Object.entries(value)) {
        if (member === undefined) continue;
        entries.push([key, valueDoc(member, `${path}.${key}`)]);
    }
    return object(entries);
}
