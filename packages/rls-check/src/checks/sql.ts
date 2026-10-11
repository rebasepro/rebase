/**
 * A deliberately small SQL scanner for policy expressions.
 *
 * This is NOT a grammar. It knows exactly enough to answer three questions
 * without being fooled: where do the parens nest, what is inside a string
 * literal (so `'... EXISTS (SELECT ...'` is never mistaken for a subquery), and
 * which identifiers are written bare.
 *
 * Everything it reads comes from `pg_policies.qual` / `with_check`, which is
 * Postgres's own re-rendering of the parse tree rather than the SQL anyone
 * typed: parenthesised more heavily, casts made explicit, and — importantly for
 * the unqualified-column check — every column inside a subquery qualified, so a
 * bare name written there never reaches this scanner from a live catalog. A hit
 * is strong evidence and a miss proves nothing, which is what the checks say.
 */

export type TokenKind = "ident" | "string" | "number" | "op" | "punct";

export interface SqlToken {
    kind: TokenKind;
    /** Lower-cased for idents and operators; raw text for strings and numbers. */
    value: string;
    /** True when the identifier arrived double-quoted, so its case is literal. */
    quoted: boolean;
    /** Paren nesting the token sits at; `(` carries the depth it opens from. */
    depth: number;
}

// Postgres allows non-ASCII letters in unquoted identifiers; rather than
// replicating its locale rules, anything above ASCII counts as an ident char.
const isIdentStart = (c: string): boolean => /[A-Za-z_]/.test(c) || c.charCodeAt(0) > 127;
const isIdentBody = (c: string): boolean => /[A-Za-z0-9_$]/.test(c) || c.charCodeAt(0) > 127;
const MULTI_CHAR_OPS = ["->>", "#>>", "::", "<=", ">=", "<>", "!=", "||", "->", "#>", "@>", "<@", "~~", "!~"];

/** Tokenize a policy expression. Never throws: unterminated quotes just run to EOF. */
export function tokenize(sql: string): SqlToken[] {
    const tokens: SqlToken[] = [];
    let depth = 0;
    let i = 0;

    while (i < sql.length) {
        const c = sql[i];

        if (/\s/.test(c)) {
            i++;
            continue;
        }

        // -- line comment
        if (c === "-" && sql[i + 1] === "-") {
            const nl = sql.indexOf("\n", i);
            i = nl === -1 ? sql.length : nl + 1;
            continue;
        }

        // /* block comment */ — Postgres nests these.
        if (c === "/" && sql[i + 1] === "*") {
            let nest = 1;
            i += 2;
            while (i < sql.length && nest > 0) {
                if (sql[i] === "/" && sql[i + 1] === "*") {
                    nest++;
                    i += 2;
                } else if (sql[i] === "*" && sql[i + 1] === "/") {
                    nest--;
                    i += 2;
                } else i++;
            }
            continue;
        }

        // $tag$ dollar-quoted string $tag$. Must be recognised before identifiers,
        // because the body can contain anything at all — including `EXISTS (`.
        if (c === "$") {
            const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
            if (tag) {
                const end = sql.indexOf(tag[0], i + tag[0].length);
                const stop = end === -1 ? sql.length : end + tag[0].length;
                tokens.push({ kind: "string", value: sql.slice(i, stop), quoted: true, depth });
                i = stop;
                continue;
            }
        }

        // '...' with '' escaping, plus E'...' backslash escaping.
        if (c === "'" || ((c === "e" || c === "E") && sql[i + 1] === "'")) {
            const escapes = c !== "'";
            let j = escapes ? i + 2 : i + 1;
            while (j < sql.length) {
                if (escapes && sql[j] === "\\") {
                    j += 2;
                    continue;
                }
                if (sql[j] === "'") {
                    if (sql[j + 1] === "'") {
                        j += 2;
                        continue;
                    }
                    j++;
                    break;
                }
                j++;
            }
            tokens.push({ kind: "string", value: sql.slice(i, j), quoted: true, depth });
            i = j;
            continue;
        }

        // "quoted identifier"
        if (c === '"') {
            let j = i + 1;
            let value = "";
            while (j < sql.length) {
                if (sql[j] === '"') {
                    if (sql[j + 1] === '"') {
                        value += '"';
                        j += 2;
                        continue;
                    }
                    j++;
                    break;
                }
                value += sql[j];
                j++;
            }
            tokens.push({ kind: "ident", value, quoted: true, depth });
            i = j;
            continue;
        }

        if (isIdentStart(c)) {
            let j = i + 1;
            while (j < sql.length && isIdentBody(sql[j])) j++;
            tokens.push({ kind: "ident", value: sql.slice(i, j).toLowerCase(), quoted: false, depth });
            i = j;
            continue;
        }

        if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(sql[i + 1] ?? ""))) {
            let j = i;
            while (j < sql.length && /[0-9.eE+-]/.test(sql[j])) {
                // Stop at a sign that is not part of an exponent.
                if ((sql[j] === "+" || sql[j] === "-") && !/[eE]/.test(sql[j - 1] ?? "")) break;
                j++;
            }
            tokens.push({ kind: "number", value: sql.slice(i, j), quoted: false, depth });
            i = j;
            continue;
        }

        if (c === "(") {
            tokens.push({ kind: "punct", value: "(", quoted: false, depth });
            depth++;
            i++;
            continue;
        }
        if (c === ")") {
            depth = Math.max(0, depth - 1);
            tokens.push({ kind: "punct", value: ")", quoted: false, depth });
            i++;
            continue;
        }
        if (c === "," || c === "." || c === "[" || c === "]" || c === ";") {
            tokens.push({ kind: "punct", value: c, quoted: false, depth });
            i++;
            continue;
        }

        const multi = MULTI_CHAR_OPS.find((op) => sql.startsWith(op, i));
        if (multi) {
            tokens.push({ kind: "op", value: multi, quoted: false, depth });
            i += multi.length;
            continue;
        }

        tokens.push({ kind: "op", value: c, quoted: false, depth });
        i++;
    }

    return tokens;
}

/** Index of the `)` matching the `(` at `open`, or -1. */
export function matchParen(tokens: SqlToken[], open: number): number {
    const base = tokens[open]?.depth ?? 0;
    for (let i = open + 1; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.kind === "punct" && t.value === ")" && t.depth === base) return i;
    }
    return -1;
}

/**
 * Every parenthesised `SELECT` in the expression, as token-index ranges.
 *
 * Covers `EXISTS (SELECT …)`, `x IN (SELECT …)`, `= ANY (SELECT …)` and plain
 * scalar subqueries in one rule, because all of them are "an open paren whose
 * first word is SELECT" and none of the checks care which form it took.
 */
export function findSubqueries(tokens: SqlToken[]): { open: number; close: number }[] {
    const out: { open: number; close: number }[] = [];
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.kind !== "punct" || t.value !== "(") continue;
        const next = tokens[i + 1];
        if (!next || next.kind !== "ident" || next.quoted || next.value !== "select") continue;
        const close = matchParen(tokens, i);
        if (close !== -1) out.push({ open: i, close });
    }
    return out;
}

/** True when the ident at `i` is written bare: no `schema.` before, no `.col` after. */
export function isBareIdent(tokens: SqlToken[], i: number): boolean {
    const t = tokens[i];
    if (!t || t.kind !== "ident") return false;
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    if (prev && prev.kind === "punct" && prev.value === ".") return false;
    if (next && next.kind === "punct" && next.value === ".") return false;
    // `lower(x)` is a call, not a column.
    if (next && next.kind === "punct" && next.value === "(") return false;
    return true;
}

/** The dotted name ending at `i`, e.g. `["public", "orders", "id"]`. */
export function qualifiedNameEndingAt(tokens: SqlToken[], i: number): string[] {
    const parts: string[] = [];
    let j = i;
    while (j >= 0 && tokens[j]?.kind === "ident") {
        parts.unshift(tokens[j].value);
        if (tokens[j - 1]?.kind === "punct" && tokens[j - 1]?.value === ".") j -= 2;
        else break;
    }
    return parts;
}

/**
 * Does this expression normalize to an unconditional truth?
 *
 * Strictly structural: parens and casts are dropped, and the expression is
 * folded only where every part is a constant. A substring match on `true`
 * would flag `(is_public = true AND owner = auth.uid())`, which is exactly the
 * kind of false positive this tool cannot afford.
 *
 * Folded: `true`, `NOT false`, a constant compared with a constant (`1 = 1`,
 * `1 > 0`, `'a'::character varying = 'a'::character varying`), and `AND` /
 * `OR` over those — `true OR x` is true whatever `x` is. Only `true`, `1 = 1`
 * and a one-word cast were, so `NOT false`, `1 > 0` and `true OR …` passed as
 * scoped policies.
 */
export function isUnconditionalTrue(expr: string | null | undefined): boolean {
    if (expr == null) return false;
    return foldsTo(withoutCasts(tokenize(expr)), true);
}

/** The words that continue a multi-word type name after `::`. */
const TYPE_CONTINUATIONS = new Set(["varying", "precision", "with", "without", "time", "zone"]);

function withoutCasts(tokens: SqlToken[]): SqlToken[] {
    const out: SqlToken[] = [];
    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].kind === "op" && tokens[i].value === "::") {
            i++; // the type name
            // `character varying`, `double precision`, `timestamp with time zone`
            while (i + 1 < tokens.length && tokens[i + 1].kind === "ident" && TYPE_CONTINUATIONS.has(tokens[i + 1].value)) i++;
            // `varchar(10)`, `numeric(10, 2)`
            if (i + 1 < tokens.length && tokens[i + 1].value === "(") {
                const close = matchParen(tokens, i + 1);
                if (close > i) i = close;
            }
            // `text[]`
            while (i + 2 < tokens.length && tokens[i + 1].value === "[" && tokens[i + 2].value === "]") i += 2;
            continue;
        }
        out.push(tokens[i]);
    }
    return out;
}

/** `tokens` with every pair of parens that wraps all of it removed. */
function unwrapped(tokens: SqlToken[]): SqlToken[] {
    let t = tokens;
    while (t.length >= 2 && t[0].value === "(" && t[0].kind === "punct" && matchParen(t, 0) === t.length - 1) {
        t = t.slice(1, -1);
    }
    return t;
}

/** Split at a keyword that sits outside every paren of `tokens`. */
function splitTopLevel(tokens: SqlToken[], word: string): SqlToken[][] {
    const parts: SqlToken[][] = [[]];
    let depth = 0;
    for (const token of tokens) {
        if (token.kind === "punct" && token.value === "(") depth++;
        if (token.kind === "punct" && token.value === ")") depth--;
        if (depth === 0 && token.kind === "ident" && !token.quoted && token.value === word) {
            parts.push([]);
            continue;
        }
        parts[parts.length - 1].push(token);
    }
    return parts;
}

/** Whether the expression is the constant `want` whatever the row and caller. */
function foldsTo(tokens: SqlToken[], want: boolean): boolean {
    const t = unwrapped(tokens);
    if (t.length === 0) return false;

    // OR binds loosest, then AND, then NOT.
    const ors = splitTopLevel(t, "or");
    if (ors.length > 1) {
        return want ? ors.some((part) => foldsTo(part, true)) : ors.every((part) => foldsTo(part, false));
    }
    const ands = splitTopLevel(t, "and");
    if (ands.length > 1) {
        return want ? ands.every((part) => foldsTo(part, true)) : ands.some((part) => foldsTo(part, false));
    }
    if (t[0].kind === "ident" && !t[0].quoted && t[0].value === "not") return foldsTo(t.slice(1), !want);

    if (t.length === 1 && t[0].kind === "ident" && !t[0].quoted) {
        return t[0].value === (want ? "true" : "false");
    }
    const compared = compareConstants(t);
    return compared !== null && compared === want;
}

/** `<constant> <op> <constant>`, evaluated, or null when it is not that. */
function compareConstants(t: SqlToken[]): boolean | null {
    if (t.length !== 3 || t[1].kind !== "op") return null;
    const [a, op, b] = [t[0], t[1].value, t[2]];
    if (a.kind === "number" && b.kind === "number") {
        const x = Number(a.value);
        const y = Number(b.value);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        switch (op) {
            case "=": return x === y;
            case "<>": case "!=": return x !== y;
            case "<": return x < y;
            case ">": return x > y;
            case "<=": return x <= y;
            case ">=": return x >= y;
            default: return null;
        }
    }
    if (a.kind === "string" && b.kind === "string") {
        if (op === "=") return a.value === b.value;
        if (op === "<>" || op === "!=") return a.value !== b.value;
    }
    return null;
}

/** Words that are never a column reference in a policy predicate. */
export const SQL_KEYWORDS = new Set([
    "select", "from", "where", "and", "or", "not", "in", "exists", "is", "null", "true", "false",
    "as", "on", "join", "inner", "left", "right", "full", "outer", "cross", "natural", "lateral",
    "group", "by", "order", "having", "limit", "offset", "union", "intersect", "except", "all",
    "any", "some", "distinct", "case", "when", "then", "else", "end", "between", "like", "ilike",
    "similar", "escape", "asc", "desc", "nulls", "first", "last", "using", "with", "recursive",
    "current_user", "session_user", "current_role", "current_date", "current_time",
    "current_timestamp", "localtime", "localtimestamp", "cast", "array", "row", "values",
    "returning", "window", "fetch", "only", "filter", "collate", "at", "time", "zone", "interval",
    "int", "int2", "int4", "int8", "integer", "bigint", "smallint", "text", "varchar", "char",
    "boolean", "bool", "uuid", "json", "jsonb", "numeric", "decimal", "real", "float", "double",
    "precision", "date", "timestamp", "timestamptz", "bytea", "name", "regclass", "oid"
]);
