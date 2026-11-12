/**
 * The layout half of the schema printer: a tiny document model and the one
 * renderer that turns it into source text.
 *
 * Printing is split in two so that every printer (columns, JSON shapes,
 * relations, rules, whole modules) only says *what* it prints, and the line
 * breaking is decided in one place, the same way for all of them:
 *
 * - an object, array or call is printed on one line when it fits in
 *   {@link PRINT_WIDTH} columns and none of its children must break;
 * - otherwise an object or array puts one entry per line, indented four
 *   spaces; a call keeps its last argument hugged against the parenthesis
 *   when that argument is an object, array or call (`col.jsonb(json.object({`),
 *   and breaks one argument per line when it is not.
 *
 * No trailing commas (the repository's `comma-dangle` rule), double quotes,
 * four-space indentation. Pure: the same document always renders to the same
 * bytes.
 */

/** The width a line may reach before an object, array or call is broken over several. */
export const PRINT_WIDTH = 120;

const INDENT = 4;

/**
 * A piece of source, before layout.
 *
 * - `text` — printed as is. Text holding a newline (a hook's source) cannot
 *   share a line with its siblings, so it forces its parents to break.
 * - `object` / `array` — a literal; `breaks` forces one entry per line.
 * - `call` — `callee(args)`.
 * - `concat` — pieces printed one after another (a builder chain).
 */
export type Doc =
    | { kind: "text"; text: string }
    | { kind: "object"; entries: ObjectEntry[]; breaks?: boolean }
    | { kind: "array"; items: Doc[]; breaks?: boolean }
    | { kind: "call"; callee: string; args: Doc[] }
    | { kind: "concat"; parts: Doc[] };

/** One `key: value` of an object literal. `key` is already printed (quoted when it must be). */
export interface ObjectEntry {
    /** The printed key: a bare identifier, or a double-quoted string. */
    key: string;
    /** The printed value. */
    value: Doc;
}

/** A piece of literal source text. */
export const text = (value: string): Doc => ({ kind: "text", text: value });

/** `callee(args)`. */
export const call = (callee: string, args: Doc[] = []): Doc => ({ kind: "call", callee, args });

/** Pieces printed one after another. */
export const concat = (parts: Doc[]): Doc => ({ kind: "concat", parts });

/** An array literal. */
export const array = (items: Doc[], breaks = false): Doc => ({ kind: "array", items, breaks });

/** An object literal from `[key, value]` pairs, keys printed bare when they can be. */
export const object = (entries: readonly (readonly [string, Doc])[], breaks = false): Doc => ({
    kind: "object",
    entries: entries.map(([key, value]) => ({ key: printKey(key), value })),
    breaks
});

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * An object key as written in source: bare when it is an identifier name
 * (reserved words included — they are legal property names), double-quoted
 * otherwise.
 */
export function printKey(key: string): string {
    return IDENTIFIER.test(key) ? key : printString(key);
}

/** A string literal, double-quoted. */
export function printString(value: string): string {
    return JSON.stringify(value);
}

/**
 * A string literal for text that may span lines (a view's query): a template
 * literal when it holds a newline, so the SQL reads as SQL, and a
 * double-quoted string otherwise.
 */
export function printMultilineString(value: string): string {
    if (!value.includes("\n")) return printString(value);
    return "`" + value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${") + "`";
}

/** The text of a doc on one line, or `undefined` when it cannot be put on one. */
function flat(doc: Doc): string | undefined {
    switch (doc.kind) {
        case "text":
            return doc.text.includes("\n") ? undefined : doc.text;
        case "object": {
            if (doc.entries.length === 0) return "{}";
            if (doc.breaks) return undefined;
            const parts: string[] = [];
            for (const entry of doc.entries) {
                const value = flat(entry.value);
                if (value === undefined) return undefined;
                parts.push(`${entry.key}: ${value}`);
            }
            return `{ ${parts.join(", ")} }`;
        }
        case "array": {
            if (doc.items.length === 0) return "[]";
            if (doc.breaks) return undefined;
            const parts: string[] = [];
            for (const item of doc.items) {
                const value = flat(item);
                if (value === undefined) return undefined;
                parts.push(value);
            }
            return `[${parts.join(", ")}]`;
        }
        case "call": {
            const parts: string[] = [];
            for (const arg of doc.args) {
                const value = flat(arg);
                if (value === undefined) return undefined;
                parts.push(value);
            }
            return `${doc.callee}(${parts.join(", ")})`;
        }
        case "concat": {
            let out = "";
            for (const part of doc.parts) {
                const value = flat(part);
                if (value === undefined) return undefined;
                out += value;
            }
            return out;
        }
    }
}

const pad = (width: number): string => " ".repeat(width);

/** The column the cursor stands at after printing `printed` from `column`. */
function columnAfter(printed: string, column: number): number {
    const newline = printed.lastIndexOf("\n");
    return newline < 0 ? column + printed.length : printed.length - newline - 1;
}

const huggable = (doc: Doc): boolean =>
    (doc.kind === "object" && doc.entries.length > 0) ||
    (doc.kind === "array" && doc.items.length > 0) ||
    (doc.kind === "call" && doc.args.length > 0);

/**
 * Lay a doc out.
 *
 * @param indent The indentation of the line the doc starts on.
 * @param column The column the doc starts at on that line.
 */
export function render(doc: Doc, indent = 0, column = indent): string {
    const oneLine = flat(doc);
    if (oneLine !== undefined && (doc.kind === "text" || column + oneLine.length <= PRINT_WIDTH)) return oneLine;
    switch (doc.kind) {
        case "text":
            return doc.text;
        case "object": {
            const inner = indent + INDENT;
            const lines = doc.entries.map(entry =>
                `${pad(inner)}${entry.key}: ${render(entry.value, inner, inner + entry.key.length + 2)}`);
            return `{\n${lines.join(",\n")}\n${pad(indent)}}`;
        }
        case "array": {
            const inner = indent + INDENT;
            const lines = doc.items.map(item => `${pad(inner)}${render(item, inner, inner)}`);
            return `[\n${lines.join(",\n")}\n${pad(indent)}]`;
        }
        case "call":
            return renderCall(doc.callee, doc.args, indent, column);
        case "concat": {
            // A chain never breaks inside a link whose arguments fit on one
            // line (`.validate({ max: 60 })` at the end of a long chain stays
            // whole): only the type builder at its head is laid out by width.
            let out = "";
            let at = column;
            for (const [index, part] of doc.parts.entries()) {
                const partFlat = index > 0 ? flat(part) : undefined;
                const printed = partFlat ?? render(part, indent, at);
                out += printed;
                at = columnAfter(printed, at);
            }
            return out;
        }
    }
}

function renderCall(callee: string, args: Doc[], indent: number, column: number): string {
    const head = `${callee}(`;
    if (args.length === 0) return `${head})`;
    const flats = args.map(flat);
    const last = args[args.length - 1];
    // One argument that cannot break (a long string, a hook's source) gains
    // nothing from a line of its own.
    if (args.length === 1 && !huggable(last)) return `${head}${render(last, indent, column + head.length)})`;
    // Hug the last argument: `rel.belongsTo(() => users, {` … `})`.
    if (huggable(last) && flats.slice(0, -1).every(value => value !== undefined)) {
        const prefix = head + flats.slice(0, -1).map(value => `${value}, `).join("");
        if (args.length === 1 || column + prefix.length <= PRINT_WIDTH) {
            return `${prefix}${render(last, indent, column + prefix.length)})`;
        }
    }
    // Hug the first: `json.object({` … `}, { additional: true })`.
    const first = args[0];
    if (args.length > 1 && huggable(first) && flats.slice(1).every(value => value !== undefined)) {
        const printed = render(first, indent, column + head.length);
        return `${head}${printed}, ${flats.slice(1).join(", ")})`;
    }
    const inner = indent + INDENT;
    const lines = args.map(arg => `${pad(inner)}${render(arg, inner, inner)}`);
    return `${head}\n${lines.join(",\n")}\n${pad(indent)})`;
}
