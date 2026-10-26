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

/**
 * One CSV field (RFC 4180): quoted when it holds a comma, a quote or a line
 * break, with each quote doubled. SQL NULL — `null` or `undefined` — is an
 * empty field, as `COPY … CSV` writes it; an object (a plan, a parsed `jsonb`)
 * is its JSON.
 *
 * Text a spreadsheet would run as a formula (`=…`, `+…`, `-…`, `@…`, a leading
 * tab or carriage return) gets a leading `'` ({@link escapeCsvFormula}), as
 * the CMS export has always done; a signed number is left a number. Every CSV
 * the product writes goes through here, so a file opened in Excel or Sheets
 * never evaluates a cell — at the cost of not being byte-identical to
 * `COPY … CSV` for such cells.
 */
export function csvField(value: unknown): string {
    if (value === null || value === undefined) return "";
    const text = escapeCsvFormula(typeof value === "object" ? JSON.stringify(value) : String(value));
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

/** One CSV record: each value through {@link csvField}, separated by commas, with no line break. */
export function csvRecord(values: readonly unknown[]): string {
    return values.map(csvField).join(",");
}
