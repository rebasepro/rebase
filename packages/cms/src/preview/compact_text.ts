/**
 * Turning block content into the one line a compact preview has room for.
 *
 * A preview slot inside a card is a single line that cannot grow. Rendering
 * Markdown there does not produce a small version of the document — it
 * produces the whole document, headings and lists included, inside a 44px box.
 * These helpers take the opening line instead, which is what a person reads
 * off a card anyway.
 */

/** Longer than any card line; the cap only keeps the DOM node small. */
const DEFAULT_MAX_LENGTH = 280;

const FENCED_CODE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
const HTML_TAG = /<[^>]*>/g;
const IMAGE = /!\[([^\]]*)\]\([^)]*\)/g;
const LINK = /\[([^\]]*)\]\([^)]*\)/g;
const REFERENCE_LINK = /\[([^\]]*)\]\[[^\]]*\]/g;
const HEADING = /^\s{0,3}#{1,6}\s+/gm;
const BLOCKQUOTE = /^\s{0,3}>\s?/gm;
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/gm;
const THEMATIC_BREAK = /^\s{0,3}(?:[-*_]\s*){3,}$/gm;
const TABLE_PIPE = /[|]/g;
const EMPHASIS = /(\*\*|__|\*|_|~~|`)/g;

/**
 * The readable text of a Markdown document, as one line.
 *
 * Deliberately a lexical strip rather than a parse: this runs once per preview
 * cell in a table that can hold hundreds, and the result is truncated to a line
 * regardless, so the cost of being exactly right is not worth paying. Anything
 * it fails to strip degrades to a stray `*`, never to a broken layout.
 */
export function markdownToPlainText(source: string, maxLength: number = DEFAULT_MAX_LENGTH): string {
    if (!source) return "";

    const text = source
        .replace(FENCED_CODE, " ")
        .replace(IMAGE, "$1")
        .replace(LINK, "$1")
        .replace(REFERENCE_LINK, "$1")
        .replace(THEMATIC_BREAK, " ")
        .replace(HEADING, "")
        .replace(BLOCKQUOTE, "")
        .replace(LIST_MARKER, "")
        .replace(HTML_TAG, "")
        .replace(TABLE_PIPE, " ")
        .replace(EMPHASIS, "");

    return collapseToSingleLine(text, maxLength);
}

/**
 * Whitespace — including the newlines that would otherwise let a `truncate`
 * container grow — collapsed to single spaces, capped to `maxLength`.
 */
export function collapseToSingleLine(source: string, maxLength: number = DEFAULT_MAX_LENGTH): string {
    if (!source) return "";
    const collapsed = source.replace(/\s+/g, " ").trim();
    if (collapsed.length <= maxLength) return collapsed;
    // Cut at a word boundary when there is one nearby, so the line does not end
    // mid-word for the sake of ten characters.
    const cut = collapsed.slice(0, maxLength);
    // The cut already landed between words: keep the last one whole.
    if (collapsed[maxLength] === " ") return cut.trimEnd() + "…";
    const lastSpace = cut.lastIndexOf(" ");
    return (lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}
