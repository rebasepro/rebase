/**
 * Byte-preserving edits of a TypeScript module's text.
 *
 * The schema editor parses with ts-morph to find positions, and writes by
 * splicing text at those positions — never through ts-morph's manipulation
 * API, which reformats what it touches. Everything outside a spliced range is
 * the file as it was: comments, blank lines, trailing commas, quote style.
 *
 * The list helpers edit the members of an object literal (`columns`,
 * `relations`, a `defineTable` config) or the elements of an array literal
 * (`rls` rules) in the layout they are written in: one member per line, or
 * all on one line.
 */
import type { Node } from "ts-morph";

/** One replacement of `[start, end)` by `text`. */
export interface TextEdit {
    start: number;
    end: number;
    text: string;
}

/** Apply non-overlapping edits to `text`. */
export function applyEdits(text: string, edits: readonly TextEdit[]): string {
    const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
    let out = text;
    let floor = Number.POSITIVE_INFINITY;
    for (const edit of sorted) {
        if (edit.end > floor) throw new Error("Overlapping source edits.");
        out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
        floor = edit.start;
    }
    return out;
}

/** The offset of the first character of the line holding `pos`. */
export function lineStart(text: string, pos: number): number {
    return text.lastIndexOf("\n", pos - 1) + 1;
}

/** The offset of the `\n` ending the line holding `pos` (or the end of the text). */
export function lineEnd(text: string, pos: number): number {
    const end = text.indexOf("\n", pos);
    return end === -1 ? text.length : end;
}

/** The whitespace a line starts with. */
export function indentAt(text: string, pos: number): string {
    const start = lineStart(text, pos);
    return /^[ \t]*/.exec(text.slice(start))?.[0] ?? "";
}

/** Whether only spaces and tabs stand between `from` and `to`. */
const blankBetween = (text: string, from: number, to: number): boolean => /^[ \t]*$/.test(text.slice(from, to));

/**
 * Text printed at indentation 0, shifted so its continuation lines sit under
 * a line indented by `indent`. The first line is placed by the caller.
 */
export function reindent(printed: string, indent: string): string {
    return printed.split("\n").map((line, index) => (index === 0 || line === "" ? line : indent + line)).join("\n");
}

/** The indentation one level deeper than `indent`, in its own unit (four spaces, or a tab). */
export function deeper(indent: string): string {
    return indent + (indent.includes("\t") ? "\t" : "    ");
}

/**
 * Where an item's own text begins, its comments included: the leading
 * comments that sit on lines of their own above it. A comment on the line of
 * the previous token (`{ // note`) belongs to that token and is not counted.
 */
export function itemStart(text: string, item: Node, previousEnd: number): number {
    for (const range of item.getLeadingCommentRanges()) {
        const pos = range.getPos();
        if (text.slice(previousEnd, pos).includes("\n")) return pos;
    }
    return item.getStart();
}

/**
 * Past the separator and the same-line comment that follow an item: the comma
 * if there is one, then a `// …` or `/* … *\/` on the same line.
 */
function afterSeparator(text: string, pos: number): { end: number; comma: boolean } {
    let at = pos;
    while (at < text.length && (text[at] === " " || text[at] === "\t")) at++;
    let comma = false;
    if (text[at] === ",") {
        comma = true;
        at++;
    }
    let probe = at;
    while (probe < text.length && (text[probe] === " " || text[probe] === "\t")) probe++;
    if (text.startsWith("//", probe)) return { end: lineEnd(text, probe), comma };
    if (text.startsWith("/*", probe)) {
        const close = text.indexOf("*/", probe + 2);
        if (close !== -1 && !text.slice(probe, close).includes("\n")) return { end: close + 2, comma };
    }
    return { end: at, comma };
}

/** An object or array literal and its members, as the list helpers see it. */
export interface ListShape {
    /** Offset just after the opening bracket. */
    open: number;
    /** Offset of the closing bracket. */
    close: number;
    /** The members, in order. */
    items: readonly Node[];
}

/** The list shape of an object literal's properties or an array literal's elements. */
export function listShape(container: Node, items: readonly Node[]): ListShape {
    return { open: container.getStart() + 1, close: container.getEnd() - 1, items };
}

/** Whether the members are written one per line. */
function isMultiline(text: string, list: ListShape): boolean {
    if (list.items.length === 0) return text.slice(list.open, list.close).includes("\n");
    const first = list.items[0];
    return text.slice(list.open, itemStart(text, first, list.open)).includes("\n");
}

/**
 * Insert `member` (printed at indentation 0) at `index` of the list.
 *
 * @param emptyStyle How an empty list is written to: `"lines"` opens it onto
 *   its own lines (an object holding columns), `"inline"` keeps it on one.
 */
export function insertListItem(text: string, list: ListShape, index: number, member: string, emptyStyle: "lines" | "inline"): TextEdit[] {
    const { items } = list;
    if (items.length === 0) {
        const containerIndent = indentAt(text, list.open - 1);
        if (emptyStyle === "lines" || text.slice(list.open, list.close).includes("\n")) {
            const indent = deeper(containerIndent);
            return [{ start: list.open, end: list.close, text: `\n${indent}${reindent(member, indent)}\n${containerIndent}` }];
        }
        const brace = text[list.open - 1] === "{";
        return [{ start: list.open, end: list.close, text: brace ? ` ${member} ` : member }];
    }
    if (isMultiline(text, list)) {
        if (index < items.length) {
            const anchor = items[index];
            const previousEnd = index === 0 ? list.open : items[index - 1].getEnd();
            const start = lineStart(text, itemStart(text, anchor, previousEnd));
            const indent = indentAt(text, anchor.getStart());
            return [{ start, end: start, text: `${indent}${reindent(member, indent)},\n` }];
        }
        const last = items[items.length - 1];
        const indent = indentAt(text, last.getStart());
        const after = afterSeparator(text, last.getEnd());
        if (after.comma) return [{ start: after.end, end: after.end, text: `\n${indent}${reindent(member, indent)},` }];
        // No trailing comma: one after the last member, the new member on the
        // line after it (and after a comment that ends the last member's line).
        const placed = `\n${indent}${reindent(member, indent)}`;
        if (after.end === last.getEnd()) return [{ start: last.getEnd(), end: last.getEnd(), text: `,${placed}` }];
        return [
            { start: last.getEnd(), end: last.getEnd(), text: "," },
            { start: after.end, end: after.end, text: placed }
        ];
    }
    if (index < items.length) {
        const anchor = items[index];
        return [{ start: anchor.getStart(), end: anchor.getStart(), text: `${member}, ` }];
    }
    const last = items[items.length - 1];
    return [{ start: last.getEnd(), end: last.getEnd(), text: `, ${member}` }];
}

/** Remove the member at `index` of the list, with its own comments and separator. */
export function removeListItem(text: string, list: ListShape, index: number): TextEdit[] {
    const { items } = list;
    const item = items[index];
    const previousEnd = index === 0 ? list.open : items[index - 1].getEnd();
    if (isMultiline(text, list)) {
        const start = lineStart(text, itemStart(text, item, previousEnd));
        const after = afterSeparator(text, item.getEnd());
        const end = blankBetween(text, after.end, lineEnd(text, after.end))
            ? Math.min(text.length, lineEnd(text, after.end) + 1)
            : after.end;
        return [{ start, end, text: "" }];
    }
    if (index < items.length - 1) return [{ start: item.getStart(), end: items[index + 1].getStart(), text: "" }];
    if (items.length > 1) {
        const after = afterSeparator(text, item.getEnd());
        return [{ start: items[index - 1].getEnd(), end: after.comma ? after.end : item.getEnd(), text: "" }];
    }
    const after = afterSeparator(text, item.getEnd());
    return [{ start: item.getStart(), end: after.comma ? after.end : item.getEnd(), text: "" }];
}

/** The member's whole text as written, its own leading comments included, for moving it. */
export function itemText(text: string, list: ListShape, index: number): string {
    const item = list.items[index];
    const previousEnd = index === 0 ? list.open : list.items[index - 1].getEnd();
    const start = itemStart(text, item, previousEnd);
    const indent = indentAt(text, item.getStart());
    // Dedent the continuation lines, so `insertListItem` can place them anew.
    return text.slice(start, item.getEnd()).split("\n")
        .map((line, i) => (i > 0 && line.startsWith(indent) ? line.slice(indent.length) : line))
        .join("\n");
}

/** Replace a node's text by `printed` (indentation 0), aligned under the line it sits on. */
export function replaceNode(text: string, node: Node, printed: string): TextEdit {
    return { start: node.getStart(), end: node.getEnd(), text: reindent(printed, indentAt(text, node.getStart())) };
}

/** Remove whole statements (with their own leading comment lines) from a module. */
export function removeStatement(text: string, statement: Node, previousEnd: number): TextEdit {
    const start = lineStart(text, itemStart(text, statement, previousEnd));
    const end = Math.min(text.length, lineEnd(text, statement.getEnd()) + 1);
    // Between two blank lines, take one of them too, so no gap of two is left.
    const blankBefore = start >= 2 && text[start - 2] === "\n";
    const blankAfter = end < text.length && text[end] === "\n";
    return { start, end: blankBefore && blankAfter ? end + 1 : end, text: "" };
}
