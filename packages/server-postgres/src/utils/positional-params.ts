/**
 * Raw SQL with `$n` placeholders, as one drizzle statement that binds each
 * parameter once.
 *
 * `rebase.sql(text, { params })` takes the text and parameters `pg` takes, and
 * has to mean what `pg` means by them. It used to split the text on every
 * `/\$(\d+)/` and bind each occurrence as a new parameter, which broke three
 * ways:
 *
 * - A `$1` written N times became N bind parameters. Postgres infers each
 *   one's type alone, so an uncast reuse failed with `could not determine data
 *   type of parameter $7` where `pg` ran the same text, and the value was sent
 *   N times.
 * - A `$1` inside a string literal, a quoted identifier, a comment or a
 *   dollar-quoted body was bound as a parameter, changing the statement.
 * - `a$1`, an identifier Postgres allows, was split in two.
 *
 * So the text is scanned the way Postgres's lexer reads it, and only a
 * placeholder outside those spans is a parameter. The first occurrence of
 * each `$n` becomes a `sql.param`; drizzle numbers params in the order they
 * appear, so a later occurrence is written as the number drizzle gave the
 * first. Each value is sent once, and every occurrence is the same parameter.
 */
import { sql, type SQL } from "drizzle-orm";

const IDENT_CHAR = /[A-Za-z0-9_$\u0080-￿]/;
const DOLLAR_TAG = /^\$([A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/;

/** One piece of the statement: SQL text, or a reference to parameter `n` (1-based). */
export type SqlPiece = { text: string } | { param: number };

/**
 * Split `text` into SQL text and `$n` placeholders, leaving string literals,
 * quoted identifiers, comments and dollar-quoted bodies whole.
 */
export function splitPlaceholders(text: string): SqlPiece[] {
    const pieces: SqlPiece[] = [];
    let start = 0;
    let i = 0;
    const flush = (end: number) => {
        if (end > start) pieces.push({ text: text.slice(start, end) });
    };
    while (i < text.length) {
        const ch = text[i];
        const next = text[i + 1];
        if (ch === "'") {
            // `E'…'` takes backslash escapes; a standard string does not.
            const escapes = i > 0 && (text[i - 1] === "E" || text[i - 1] === "e") && (i < 2 || !IDENT_CHAR.test(text[i - 2]));
            i++;
            while (i < text.length) {
                if (escapes && text[i] === "\\") { i += 2; continue; }
                if (text[i] === "'") {
                    if (text[i + 1] === "'") { i += 2; continue; }
                    break;
                }
                i++;
            }
            i++;
        } else if (ch === "\"") {
            i++;
            while (i < text.length) {
                if (text[i] === "\"") {
                    if (text[i + 1] === "\"") { i += 2; continue; }
                    break;
                }
                i++;
            }
            i++;
        } else if (ch === "-" && next === "-") {
            const end = text.indexOf("\n", i);
            i = end === -1 ? text.length : end + 1;
        } else if (ch === "/" && next === "*") {
            // Block comments nest in Postgres.
            let depth = 1;
            i += 2;
            while (i < text.length && depth > 0) {
                if (text[i] === "/" && text[i + 1] === "*") { depth++; i += 2; } else if (text[i] === "*" && text[i + 1] === "/") { depth--; i += 2; } else i++;
            }
        } else if (ch === "$" && (i === 0 || !IDENT_CHAR.test(text[i - 1]))) {
            const digits = /^\$(\d+)/.exec(text.slice(i));
            if (digits) {
                flush(i);
                pieces.push({ param: Number(digits[1]) });
                i += digits[0].length;
                start = i;
                continue;
            }
            const tag = DOLLAR_TAG.exec(text.slice(i));
            if (tag) {
                const close = text.indexOf(tag[0], i + tag[0].length);
                i = close === -1 ? text.length : close + tag[0].length;
            } else {
                i++;
            }
        } else if (IDENT_CHAR.test(ch)) {
            // An identifier or keyword, `$` included: `a$1` is one name.
            while (i < text.length && IDENT_CHAR.test(text[i])) i++;
        } else {
            i++;
        }
    }
    flush(text.length);
    return pieces;
}

/**
 * `text` and `params` as one drizzle statement: each `$n` bound once, however
 * often it appears, and nothing inside a literal, identifier or comment bound.
 */
export function positionalStatement(text: string, params?: readonly unknown[]): SQL {
    if (!params || params.length === 0) return sql.raw(text);
    const chunks: SQL[] = [];
    // Parameter n (1-based, as written) → the number drizzle gave its first use.
    const bound = new Map<number, number>();
    for (const piece of splitPlaceholders(text)) {
        if ("text" in piece) {
            chunks.push(sql.raw(piece.text));
            continue;
        }
        const placed = bound.get(piece.param);
        if (placed !== undefined) {
            chunks.push(sql.raw(`$${placed}`));
        } else {
            bound.set(piece.param, bound.size + 1);
            chunks.push(sql`${sql.param(params[piece.param - 1])}`);
        }
    }
    return sql.join(chunks, sql.raw(""));
}
