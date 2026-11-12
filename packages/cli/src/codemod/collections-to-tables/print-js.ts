/**
 * Printing plain values as TypeScript source, with code spliced in.
 *
 * The codemod writes two kinds of value: data it read off an evaluated
 * collection (strings, numbers, arrays, objects), printed here, and code it
 * read off the legacy source (a hook, an entity action, a component), carried
 * as {@link RawSource} and printed verbatim, re-indented to where it lands.
 *
 * Same conventions as the shared table printer: four-space indentation,
 * double quotes, no trailing commas, one entry per line for a non-empty
 * object.
 */

/** Source text printed verbatim. Its first line starts at column 0; later lines carry their indentation relative to it. */
export class RawSource {
    constructor(readonly text: string) {}
}

const INDENT = "    ";
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** An object key as written: bare when it is an identifier, quoted otherwise. */
export function printKey(key: string): string {
    return IDENTIFIER.test(key) ? key : JSON.stringify(key);
}

/** A string literal, double-quoted. */
export function printStringLiteral(value: string): string {
    return JSON.stringify(value);
}

/**
 * Re-indent raw source to land at `indent`: every line after the first gets
 * the prefix, so the block keeps its own shape.
 */
export function reindent(text: string, indent: string): string {
    const lines = text.split("\n");
    return lines.map((line, index) => (index === 0 || line.length === 0 ? line : `${indent}${line}`)).join("\n");
}

/**
 * Strip the indentation a node had in its file: `text` is the node's text
 * (its first line starts at the node), `baseIndent` the leading whitespace of
 * the line it starts on. Later lines that start with that whitespace lose it.
 */
export function dedent(text: string, baseIndent: string): string {
    if (baseIndent.length === 0) return text;
    return text
        .split("\n")
        .map((line, index) => (index > 0 && line.startsWith(baseIndent) ? line.slice(baseIndent.length) : line))
        .join("\n");
}

/** Thrown for a value that is code, and that no source text was found for. */
export class UnprintableValueError extends Error {
    constructor(readonly path: string, message: string) {
        super(`${path}: ${message}`);
    }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const proto: unknown = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/** Whether a value holds a function anywhere: it then needs source text to print. */
export function containsCode(value: unknown, seen: Set<unknown> = new Set()): boolean {
    if (typeof value === "function") return true;
    if (value instanceof RawSource) return false;
    if (typeof value !== "object" || value === null || seen.has(value)) return false;
    seen.add(value);
    if (Array.isArray(value)) return value.some(entry => containsCode(entry, seen));
    if (!isPlainObject(value)) return true;
    return Object.values(value).some(entry => containsCode(entry, seen));
}

/**
 * A value as source text, starting at `indent` (the indentation of the line
 * it begins on).
 */
export function printValue(value: unknown, indent = "", path = "value"): string {
    if (value instanceof RawSource) return reindent(value.text, indent);
    if (value === undefined) return "undefined";
    if (value === null) return "null";
    switch (typeof value) {
        case "string":
            return printStringLiteral(value);
        case "number":
            if (Number.isNaN(value)) return "NaN";
            if (!Number.isFinite(value)) return value > 0 ? "Infinity" : "-Infinity";
            return Object.is(value, -0) ? "-0" : String(value);
        case "boolean":
            return String(value);
        case "bigint":
            return `${value}n`;
        case "function":
            throw new UnprintableValueError(path, "it is a function, and no source text for it was found.");
        default:
            break;
    }
    const inner = indent + INDENT;
    if (Array.isArray(value)) {
        if (value.length === 0) return "[]";
        const items = value.map((entry, index) => printValue(entry, inner, `${path}[${index}]`));
        const flat = `[${items.join(", ")}]`;
        if (!flat.includes("\n") && flat.length + indent.length <= 100 && value.every(entry => typeof entry !== "object" || entry === null)) {
            return flat;
        }
        return `[\n${items.map(item => `${inner}${item}`).join(",\n")}\n${indent}]`;
    }
    if (value instanceof Date) return `new Date(${printStringLiteral(value.toISOString())})`;
    if (!isPlainObject(value)) {
        throw new UnprintableValueError(path, "it is an instance of a class, which cannot be printed as a literal.");
    }
    const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
    if (entries.length === 0) return "{}";
    const lines = entries.map(([key, entry]) => `${inner}${printKey(key)}: ${printValue(entry, inner, `${path}.${key}`)}`);
    return `{\n${lines.join(",\n")}\n${indent}}`;
}
