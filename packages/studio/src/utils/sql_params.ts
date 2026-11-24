/**
 * `:name` placeholders in the SQL console: found by a tokenizer that knows
 * where a `:name` is SQL text and where it is not, and filled in with
 * literals the database reads back exactly.
 *
 * A placeholder is a colon and an identifier (`:user_id`, `:From`) outside a
 * string, a quoted identifier, a dollar-quoted body, a comment and an array
 * subscript — and not the second colon of a `::` cast, so `created_at::date`
 * names no parameter. Matching is case-sensitive, as the text is.
 */

/** One `:name` in the text, by its position. */
export interface SqlParameterOccurrence {
    name: string;
    /** Offset of the colon. */
    start: number;
    /** Offset just past the name. */
    end: number;
}

/**
 * What a parameter is filled in with: a quoted literal of `value` (`text`),
 * SQL `NULL` (`null`), or `value` exactly as written (`raw`) — a number, an
 * identifier, an expression.
 */
export interface SqlParameterValue {
    mode: "text" | "null" | "raw";
    value: string;
}

const IDENTIFIER_START = /[A-Za-z_\u0080-￿]/;
const IDENTIFIER_PART = /[A-Za-z0-9_$\u0080-￿]/;

/**
 * Where the dollar quote opening at `start` ends its tag (`$$`, `$body$`), or
 * -1 when the `$` there opens none — `$1` is a positional parameter.
 */
function dollarTagEnd(sql: string, start: number): number {
    let index = start + 1;
    if (sql[index] === "$") return index + 1;
    if (!IDENTIFIER_START.test(sql[index] ?? "") || sql[index] === "$") return -1;
    while (index < sql.length && /[A-Za-z0-9_\u0080-￿]/.test(sql[index])) index++;
    return sql[index] === "$" ? index + 1 : -1;
}

/** Every `:name` placeholder in `sql`, in order. */
export function findSqlParameters(sql: string): SqlParameterOccurrence[] {
    const found: SqlParameterOccurrence[] = [];
    let bracketDepth = 0;
    let index = 0;
    while (index < sql.length) {
        const char = sql[index];
        const next = sql[index + 1];

        // -- line comment
        if (char === "-" && next === "-") {
            const end = sql.indexOf("\n", index + 2);
            index = end === -1 ? sql.length : end + 1;
            continue;
        }
        // /* block comment */, which nests in Postgres
        if (char === "/" && next === "*") {
            let depth = 1;
            index += 2;
            while (index < sql.length && depth > 0) {
                if (sql[index] === "/" && sql[index + 1] === "*") { depth++; index += 2; }
                else if (sql[index] === "*" && sql[index + 1] === "/") { depth--; index += 2; }
                else index++;
            }
            continue;
        }
        // 'string', E'string' with backslash escapes, and '' inside either
        if (char === "'") {
            const escapes = index > 0 && /[eE]/.test(sql[index - 1]) && !IDENTIFIER_PART.test(sql[index - 2] ?? "");
            index++;
            while (index < sql.length) {
                if (escapes && sql[index] === "\\") { index += 2; continue; }
                if (sql[index] === "'") {
                    if (sql[index + 1] === "'") { index += 2; continue; }
                    index++;
                    break;
                }
                index++;
            }
            continue;
        }
        // "quoted identifier"
        if (char === "\"") {
            index++;
            while (index < sql.length) {
                if (sql[index] === "\"") {
                    if (sql[index + 1] === "\"") { index += 2; continue; }
                    index++;
                    break;
                }
                index++;
            }
            continue;
        }
        // $tag$ dollar-quoted body $tag$ — not when the `$` ends an identifier (`a$b`)
        if (char === "$" && !IDENTIFIER_PART.test(sql[index - 1] ?? "")) {
            const tagEnd = dollarTagEnd(sql, index);
            if (tagEnd !== -1) {
                const tag = sql.slice(index, tagEnd);
                const close = sql.indexOf(tag, tagEnd);
                index = close === -1 ? sql.length : close + tag.length;
                continue;
            }
        }
        if (char === "[") { bracketDepth++; index++; continue; }
        if (char === "]") { bracketDepth = Math.max(0, bracketDepth - 1); index++; continue; }
        if (char === ":") {
            // `::type` — a cast, both colons, never a placeholder.
            if (next === ":") { index += 2; continue; }
            // `arr[lo:hi]` is a slice; `:=` a named argument.
            if (bracketDepth === 0 && IDENTIFIER_START.test(next ?? "") && !IDENTIFIER_PART.test(sql[index - 1] ?? "")) {
                let end = index + 1;
                while (end < sql.length && IDENTIFIER_PART.test(sql[end]) && sql[end] !== "$") end++;
                found.push({ name: sql.slice(index + 1, end), start: index, end });
                index = end;
                continue;
            }
        }
        index++;
    }
    return found;
}

/** The distinct parameter names of `sql`, in the order they first appear. */
export function sqlParameterNames(sql: string): string[] {
    return [...new Set(findSqlParameters(sql).map(occurrence => occurrence.name))];
}

/**
 * `value` as a SQL string literal: single quotes doubled, and an `E''`
 * literal with its backslashes doubled when it holds one, so the database
 * reads the same characters whatever `standard_conforming_strings` says.
 */
export function quoteSqlLiteral(value: string): string {
    const quoted = value.replace(/'/g, "''");
    return value.includes("\\") ? `E'${quoted.replace(/\\/g, "\\\\")}'` : `'${quoted}'`;
}

/** What `parameter` is written as in the SQL that runs. */
export function sqlParameterText(parameter: SqlParameterValue): string {
    switch (parameter.mode) {
        case "null": return "NULL";
        case "raw": return parameter.value;
        case "text": return quoteSqlLiteral(parameter.value);
    }
}

/**
 * `sql` with every placeholder replaced by its value's text. A placeholder
 * with no value is a mistake the caller asks about first —
 * {@link missingSqlParameters} — and is left as written here.
 */
export function substituteSqlParameters(sql: string, values: Readonly<Record<string, SqlParameterValue>>): string {
    let out = "";
    let last = 0;
    for (const occurrence of findSqlParameters(sql)) {
        const value = values[occurrence.name];
        if (!value) continue;
        out += sql.slice(last, occurrence.start) + sqlParameterText(value);
        last = occurrence.end;
    }
    return out + sql.slice(last);
}

/**
 * The placeholders of `sql` that `values` gives nothing for: no entry, or an
 * empty one that is not NULL. An empty string is written as the raw `''`, so
 * a field left blank is never run as one by accident.
 */
export function missingSqlParameters(sql: string, values: Readonly<Record<string, SqlParameterValue>>): string[] {
    return sqlParameterNames(sql).filter(name => {
        const value = values[name];
        return !value || (value.mode !== "null" && value.value === "");
    });
}
