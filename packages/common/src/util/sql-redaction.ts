/**
 * SQL a person ran, as the audit log may keep it: every string literal masked.
 *
 * The SQL console's audit line wrote the statement verbatim, so `ALTER ROLE app
 * PASSWORD 'hunter2'`, `CREATE USER MAPPING … OPTIONS (password 'hunter2')` and
 * `dblink_connect('host=db password=hunter2')` put the password in the
 * production logs, where the logger's redaction — by key name — never looks.
 *
 * A literal is a value the statement carries inline, which is exactly what the
 * line already declines to write when it is bound as a parameter: the
 * statement's shape is the audit signal, the values are whatever the operator
 * was touching. So every literal goes, not only the ones beside a word that
 * looks like `password` — a secret has no reliable neighbour. Identifiers,
 * keywords, numbers and comments stay.
 *
 * Read with Postgres's own lexical rules, not a regular expression over the
 * text: a quote inside a comment, a doubled quote, an `E'…\'…'` escape or a
 * `$tag$` body must not shift where a literal is thought to end, or the mask
 * covers the statement and leaves the secret.
 */
export function redactSqlLiterals(sql: string): string {
    let out = "";
    let i = 0;
    while (i < sql.length) {
        const char = sql[i];
        const next = sql[i + 1];

        // -- line comment
        if (char === "-" && next === "-") {
            const end = sql.indexOf("\n", i);
            const stop = end === -1 ? sql.length : end;
            out += sql.slice(i, stop);
            i = stop;
            continue;
        }

        // /* block comment */ — nested, as Postgres reads them
        if (char === "/" && next === "*") {
            let depth = 1;
            let j = i + 2;
            while (j < sql.length && depth > 0) {
                if (sql[j] === "/" && sql[j + 1] === "*") { depth++; j += 2; } else if (sql[j] === "*" && sql[j + 1] === "/") { depth--; j += 2; } else j++;
            }
            out += sql.slice(i, j);
            i = j;
            continue;
        }

        // "quoted identifier"
        if (char === "\"") {
            const end = closingQuote(sql, i + 1, "\"", false);
            out += sql.slice(i, end);
            i = end;
            continue;
        }

        // 'string', E'string' with backslash escapes, and the B'', X'', N'',
        // U&'' prefixes — the prefix is kept, the content masked.
        if (char === "'") {
            const prefix = /(?:^|[^A-Za-z0-9_$])([EeBbXxNn]|[Uu]&)$/.exec(out)?.[1] ?? "";
            out += "'***'";
            i = closingQuote(sql, i + 1, "'", prefix.toUpperCase() === "E");
            continue;
        }

        // $tag$ … $tag$ — a dollar-quoted string. A function or DO body is SQL
        // in its own right, and its literals are masked as these are; a
        // password written as `PASSWORD $$hunter2$$` is masked whole.
        if (char === "$") {
            const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
            const precededByIdentifier = /[A-Za-z0-9_]$/.test(out);
            if (tag && !precededByIdentifier) {
                const delimiter = tag[0];
                const bodyStart = i + delimiter.length;
                const bodyEnd = sql.indexOf(delimiter, bodyStart);
                const stop = bodyEnd === -1 ? sql.length : bodyEnd;
                const body = sql.slice(bodyStart, stop);
                const isPassword = /\bpassword\s*$/i.test(out);
                out += delimiter + (isPassword ? "***" : redactSqlLiterals(body)) + (bodyEnd === -1 ? "" : delimiter);
                i = bodyEnd === -1 ? sql.length : bodyEnd + delimiter.length;
                continue;
            }
        }

        out += char;
        i++;
    }
    return out;
}

/**
 * The index just past the quote that closes a literal or identifier opened
 * before `from`. A doubled quote is one quote inside it; with `backslashEscapes`
 * (an `E''` string) so is a backslash-escaped one. Unterminated runs to the end.
 */
function closingQuote(sql: string, from: number, quote: string, backslashEscapes: boolean): number {
    let j = from;
    while (j < sql.length) {
        if (backslashEscapes && sql[j] === "\\") { j += 2; continue; }
        if (sql[j] === quote) {
            if (sql[j + 1] === quote) { j += 2; continue; }
            return j + 1;
        }
        j++;
    }
    return sql.length;
}
