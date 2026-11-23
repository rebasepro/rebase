import type { Plugin } from "vite";

/**
 * Escapes every character above U+00FF inside the string and template literals
 * of an emitted chunk, so V8 can hold the chunk's source as a one-byte string.
 *
 * V8 keeps the source text of every module it loads for as long as the process
 * runs — lazy compilation and `Function.prototype.toString` both read it — and
 * stores a string as Latin-1 only when every character fits. One em dash in an
 * error message stores a whole 1.6 MB chunk as UTF-16, two bytes per
 * character. A runtime loads about 5 MB of built source from this repository,
 * so without this every process holds it twice over.
 *
 * `"—"` and `"—"` are the same string, so nothing a program can observe
 * changes. The build checks that rather than assuming it: it parses its own
 * output and compares every literal's value with the original's, and fails if
 * one differs.
 *
 * Left alone, because escaping would change what a program sees: tagged
 * templates (a tag can read `raw`) and regular expressions. A chunk that keeps
 * a character above U+00FF there — or in a comment or an identifier — fails the
 * build with its location, because it would quietly be stored as UTF-16 again.
 * `allow` names the chunks that may.
 */
export function oneByteSource(options: { allow?: (fileName: string) => boolean } = {}): Plugin {
    return {
        name: "rebase:one-byte-source",
        apply: "build",
        // In `generateBundle`, not `renderChunk`: the bundler prints every chunk
        // once more after `renderChunk` (dead-code elimination runs even with
        // `minify: false`), and its printer writes string values back out as
        // raw characters.
        generateBundle(_options, bundle) {
            for (const chunk of Object.values(bundle)) {
                if (chunk.type !== "chunk" || !WIDE.test(chunk.code)) continue;
                const { code, edits } = escapeWideLiterals(chunk.code, input => this.parse(input), chunk.fileName);
                const left = WIDE.exec(code);
                if (left && !options.allow?.(chunk.fileName)) {
                    const at = left.index;
                    throw new Error(
                        `${chunk.fileName}: a character above U+00FF outside a string or template literal ` +
                        `keeps this chunk two-byte in memory: ${JSON.stringify(code.slice(Math.max(0, at - 60), at + 20))}. ` +
                        "Write it as a \\u escape in the source, or move it into a string literal."
                    );
                }
                if (chunk.map) chunk.map.mappings = shiftGeneratedColumns(chunk.map.mappings, chunk.code, edits);
                chunk.code = code;
            }
        }
    };
}

/** An ESTree parser that reports UTF-16 offsets — the bundler's own `this.parse`. */
export type Parse = (code: string) => unknown;

/**
 * `code` with every character above U+00FF in its string literals and untagged
 * template quasis written as a `\u` escape, and the edits that made it. Throws
 * if the result's literals do not evaluate to exactly the original's.
 */
export function escapeWideLiterals(code: string, parse: Parse, fileName = "<chunk>"): { code: string; edits: Edit[] } {
    const edits = literalEdits(code, parse);
    const output = applyEdits(code, edits);
    assertSameLiterals(code, output, parse, fileName);
    return { code: output, edits };
}

const WIDE = /[\u0100-\uffff]/;

export interface Edit {
    start: number;
    end: number;
    text: string;
}

type AstNode = Record<string, unknown> & { type: string; start: number; end: number };

function isNode(value: unknown): value is AstNode {
    return typeof value === "object" && value !== null
        && "type" in value && typeof value.type === "string"
        && "start" in value && typeof value.start === "number"
        && "end" in value && typeof value.end === "number";
}

function parseProgram(code: string, parse: Parse): AstNode {
    const program: unknown = parse(code);
    if (!isNode(program)) throw new Error("the parser returned something that is not an ESTree node");
    return program;
}

function children(node: AstNode): AstNode[] {
    const out: AstNode[] = [];
    for (const key of Object.keys(node)) {
        const value = node[key];
        if (Array.isArray(value)) {
            for (const item of value) if (isNode(item)) out.push(item);
        } else if (isNode(value)) {
            out.push(value);
        }
    }
    return out;
}

/** String literals and the quasis of untagged templates, in source order. */
function escapableRanges(code: string, parse: Parse): Array<{ start: number; end: number }> {
    const program = parseProgram(code, parse);
    const taggedQuasis = new Set<AstNode>();
    const markTagged = (node: AstNode) => {
        if (node.type === "TaggedTemplateExpression" && isNode(node.quasi)) taggedQuasis.add(node.quasi);
        for (const child of children(node)) markTagged(child);
    };
    markTagged(program);

    const ranges: Array<{ start: number; end: number }> = [];
    const walk = (node: AstNode, parent: AstNode | undefined) => {
        if (node.type === "Literal" && typeof node.value === "string") {
            ranges.push({ start: node.start, end: node.end });
            return;
        }
        if (node.type === "TemplateElement" && parent !== undefined && !taggedQuasis.has(parent)) {
            ranges.push({ start: node.start, end: node.end });
            return;
        }
        for (const child of children(node)) walk(child, node);
    };
    walk(program, undefined);
    return ranges.sort((a, b) => a.start - b.start);
}

function literalEdits(code: string, parse: Parse): Edit[] {
    const edits: Edit[] = [];
    for (const range of escapableRanges(code, parse)) {
        for (let i = range.start; i < range.end; i++) {
            const unit = code.charCodeAt(i);
            if (unit <= 0xff) continue;
            let start = i;
            let end = i + 1;
            if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < range.end) {
                const next = code.charCodeAt(i + 1);
                if (next >= 0xdc00 && next <= 0xdfff) end = i + 2;
            }
            let backslashes = 0;
            for (let j = i - 1; j >= range.start && code.charCodeAt(j) === 0x5c; j--) backslashes++;
            let text = escapeUnits(code.slice(i, end));
            if (backslashes % 2 === 1) {
                // The `\` before the character is part of an escape: an identity
                // escape (`\—` is `—`), or a line continuation, which is nothing.
                start = i - 1;
                if (unit === 0x2028 || unit === 0x2029) text = "";
            }
            edits.push({ start, end, text });
            i = end - 1;
        }
    }
    return edits;
}

function escapeUnits(text: string): string {
    let out = "";
    for (let k = 0; k < text.length; k++) out += "\\u" + text.charCodeAt(k).toString(16).padStart(4, "0");
    return out;
}

function applyEdits(code: string, edits: Edit[]): string {
    let out = "";
    let at = 0;
    for (const edit of edits) {
        out += code.slice(at, edit.start) + edit.text;
        at = edit.end;
    }
    return out + code.slice(at);
}

/** What every string literal, template quasi and regular expression evaluates to, in order. */
function literalValues(code: string, parse: Parse): string[] {
    const values: string[] = [];
    const walk = (node: AstNode) => {
        if (node.type === "Literal") {
            if (typeof node.value === "string") values.push(`s:${node.value}`);
            else if ("regex" in node && node.regex !== undefined) values.push(`r:${String(node.raw)}`);
        }
        if (node.type === "TemplateElement") {
            const value = node.value;
            const cooked = typeof value === "object" && value !== null && "cooked" in value ? value.cooked : undefined;
            values.push(`t:${String(cooked)}`);
        }
        for (const child of children(node)) walk(child);
    };
    walk(parseProgram(code, parse));
    return values;
}

function assertSameLiterals(before: string, after: string, parse: Parse, fileName: string): void {
    const a = literalValues(before, parse);
    const b = literalValues(after, parse);
    const at = a.findIndex((value, i) => value !== b[i]);
    if (a.length !== b.length || at !== -1) {
        throw new Error(
            `${fileName}: escaping characters above U+00FF changed a literal ` +
            `(${a.length} literals before, ${b.length} after; first difference at #${at}: ` +
            `${JSON.stringify(a[at])} became ${JSON.stringify(b[at])}).`
        );
    }
}

/**
 * The chunk's source map, moved onto the escaped code. No edit adds or removes
 * a line, so only generated columns change: each one after an edit on its line
 * moves right by what the edits before it added. The other fields are deltas
 * that do not involve the generated column, so their text is kept as it is.
 */
export function shiftGeneratedColumns(mappings: string, code: string, edits: Edit[]): string {
    const lineStarts = [0];
    for (let i = code.indexOf("\n"); i !== -1; i = code.indexOf("\n", i + 1)) lineStarts.push(i + 1);
    const editsByLine = new Map<number, Edit[]>();
    let line = 0;
    for (const edit of edits) {
        while (line + 1 < lineStarts.length && lineStarts[line + 1] <= edit.start) line++;
        const list = editsByLine.get(line) ?? [];
        list.push(edit);
        editsByLine.set(line, list);
    }
    return mappings.split(";").map((segments, lineIndex) => {
        const lineEdits = editsByLine.get(lineIndex);
        if (!lineEdits || segments === "") return segments;
        let column = 0;
        let previousShifted = 0;
        return segments.split(",").map(segment => {
            const [delta, rest] = readVlq(segment);
            column += delta;
            let shifted = column;
            for (const edit of lineEdits) {
                if (edit.end - lineStarts[lineIndex] <= column) shifted += edit.text.length - (edit.end - edit.start);
            }
            const out = vlq(shifted - previousShifted) + rest;
            previousShifted = shifted;
            return out;
        }).join(",");
    }).join(";");
}

/** The first VLQ value of `segment`, and the text after it. */
function readVlq(segment: string): [number, string] {
    let value = 0;
    let shift = 0;
    let i = 0;
    for (; i < segment.length; i++) {
        const digit = BASE64.indexOf(segment[i]);
        value += (digit & 31) << shift;
        shift += 5;
        if ((digit & 32) === 0) {
            i++;
            break;
        }
    }
    const negative = (value & 1) === 1;
    value >>>= 1;
    return [negative ? -value : value, segment.slice(i)];
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function vlq(value: number): string {
    let rest = value < 0 ? (-value << 1) | 1 : value << 1;
    let out = "";
    do {
        let digit = rest & 31;
        rest >>>= 5;
        if (rest > 0) digit |= 32;
        out += BASE64[digit];
    } while (rest > 0);
    return out;
}
