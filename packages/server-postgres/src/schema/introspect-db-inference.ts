import type { ColumnType, ColumnValidation } from "@rebasepro/types";

/**
 * What sampled rows suggest about a column (`schema introspect
 * --data-inference`).
 *
 * The column's type is the catalogue's and is never second-guessed from data:
 * a `smallint` holding only 0s and 1s is still a `smallint`, a `text` of ISO
 * dates is still `text`, and declaring otherwise would plan a type change on
 * the first push. What the rows can add is what the type does not say — a
 * bound the API may check, and how the panel should edit the value.
 */
export interface ColumnHints {
    /** Rules the API checks before a write, merged into the column's `.validate()`. */
    validate?: ColumnValidation;
    /** Field options for the panel, written into the table's `customizeTable`. */
    field?: { multiline?: true; markdown?: true; urlPreview?: "image" };
}

const MARKDOWN = [/^#{1,6}\s+.+/m, /\*\*.+\*\*/, /\[.+\]\(.+\)/, /^\s*[-*]\s+.+/m];
const IMAGE_FILE = /\.(jpeg|jpg|gif|png|webp|svg)(\?|$)/i;
const MEDIA_NAME = /image|avatar|photo|logo|cover/;

const isNumericType = (type: ColumnType): boolean =>
    ["smallint", "integer", "bigint", "real", "doublePrecision", "numeric"].includes(type.kind);
const isTextType = (type: ColumnType): boolean => type.kind === "text" || type.kind === "varchar" || type.kind === "char";

/**
 * Read a column's sampled values for what they add to its declared type.
 *
 * - a number column named like a percentage (`*percent*`, `*rate*`, `*score*`)
 *   whose values lie in 0–100 is validated to that range; one named like a
 *   quantity (`*count*`, `*total*`, `*amount*`) with no negative value, to `min: 0`;
 * - a text column whose every value is an absolute URL is validated as one,
 *   and previewed as an image when the values (or the name) say so;
 * - a text column holding markdown is edited as markdown, one holding line
 *   breaks or long values in a multi-line box.
 */
export function inferColumnHints(columnName: string, type: ColumnType, sampleValues: readonly unknown[]): ColumnHints {
    const values = sampleValues.filter(value => value !== null && value !== undefined && value !== "");
    if (values.length === 0) return {};
    const name = columnName.toLowerCase();

    if (isNumericType(type)) {
        const numbers = values.map(Number).filter(value => !Number.isNaN(value));
        if (numbers.length !== values.length) return {};
        const min = Math.min(...numbers);
        const max = Math.max(...numbers);
        if (min >= 0 && max <= 100 && /percent|rate|score/.test(name)) return { validate: { min: 0, max: 100 } };
        if (min >= 0 && /count|total|amount/.test(name)) return { validate: { min: 0 } };
        return {};
    }

    if (!isTextType(type) || !values.every(value => typeof value === "string")) return {};
    const strings = values.filter((value): value is string => typeof value === "string");
    const hints: ColumnHints = {};
    if (strings.every(value => value.startsWith("http://") || value.startsWith("https://"))) {
        hints.validate = { url: true };
        if (strings.some(value => IMAGE_FILE.test(value)) || MEDIA_NAME.test(name)) hints.field = { urlPreview: "image" };
        return hints;
    }
    const longest = Math.max(...strings.map(value => value.length));
    if (strings.some(value => MARKDOWN.some(pattern => pattern.test(value)))) hints.field = { multiline: true, markdown: true };
    else if (strings.some(value => value.includes("\n")) || longest > 100) hints.field = { multiline: true };
    return hints;
}
