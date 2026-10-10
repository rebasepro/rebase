/**
 * One CSV field (RFC 4180): quoted when it holds a comma, a quote or a line
 * break, with each quote doubled. SQL NULL — `null` or `undefined` — is an
 * empty field, as `COPY … CSV` writes it; an object (a plan, a parsed `jsonb`)
 * is its JSON.
 */
export function csvField(value: unknown): string {
    if (value === null || value === undefined) return "";
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

/** One CSV record: each value through {@link csvField}, separated by commas, with no line break. */
export function csvRecord(values: readonly unknown[]): string {
    return values.map(csvField).join(",");
}
