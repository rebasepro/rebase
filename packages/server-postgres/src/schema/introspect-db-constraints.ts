/**
 * Reading validation rules out of CHECK constraints.
 *
 * A CHECK constraint is the schema author stating a rule the database already
 * enforces. Introspection has never read them, so a generated form let the user
 * type a value the database was always going to reject — the rule was written
 * down, in the schema, and the UI asked anyway.
 *
 * Everything here parses the *normalized* text `pg_get_constraintdef` produces,
 * not what the author typed: Postgres re-renders the expression from its parse
 * tree, so `CHECK (price > 0)` on a `numeric` column always comes back as
 * `CHECK ((price > (0)::numeric))`. That normalization is what makes a
 * string-level parser tractable — the input is generated, and the shapes are
 * few.
 *
 * Constraints this cannot read are skipped in full. A partially-understood
 * constraint is worse than an unread one: it would produce validation that
 * *narrows* differently from the database, so a value the UI accepts still
 * fails on write, or — worse — a value the database allows is refused in the
 * form with no way to see why.
 *
 * Pure module: no I/O, no logging.
 */
import type { CheckConstraintRow } from "./introspect-db-logic";

/** What a table's CHECK constraints say about one column. */
export interface ColumnCheckFacts {
    /** Allowed values, from `IN (…)` / `= ANY (ARRAY[…])` / `= 'literal'`. */
    enumValues?: string[];
    /** `x >= n` */
    min?: number;
    /** `x <= n` */
    max?: number;
    /** `x > n` */
    moreThan?: number;
    /** `x < n` */
    lessThan?: number;
    /** `length(x) >= n` */
    lengthMin?: number;
    /** `length(x) <= n` */
    lengthMax?: number;
}

/** Per-table, per-column facts. */
export type CheckFactsByTable = Map<string, Map<string, ColumnCheckFacts>>;

/** The length functions whose argument is the column being constrained. */
const LENGTH_FUNCTIONS = new Set(["length", "char_length", "character_length", "octet_length"]);

/**
 * Splits on a separator that appears at paren depth 0 and outside string
 * literals.
 *
 * Depth tracking is the whole job: `ARRAY['a', 'b']` contains a comma that must
 * not split the enclosing argument list, and `'it''s'` contains a quote that
 * must not end the literal.
 */
function splitTopLevel(input: string, separator: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let inString = false;
    let current = "";

    for (let i = 0; i < input.length; i++) {
        const ch = input[i];

        if (inString) {
            current += ch;
            if (ch === "'") {
                // '' inside a literal is an escaped quote, not the end of it.
                if (input[i + 1] === "'") {
                    current += input[++i];
                } else {
                    inString = false;
                }
            }
            continue;
        }

        if (ch === "'") {
            inString = true;
            current += ch;
            continue;
        }
        if (ch === "(" || ch === "[") depth++;
        if (ch === ")" || ch === "]") depth--;

        if (depth === 0 && input.startsWith(separator, i)) {
            // A word separator must not match inside an identifier: "AND" is a
            // separator in `a AND b` but not in `brand = 1`.
            const before = input[i - 1];
            const after = input[i + separator.length];
            const wordish = /[A-Za-z]/.test(separator[0]);
            const boundedOk = !wordish || ((before === undefined || !/[A-Za-z0-9_]/.test(before)) &&
                (after === undefined || !/[A-Za-z0-9_]/.test(after)));
            if (boundedOk) {
                parts.push(current);
                current = "";
                i += separator.length - 1;
                continue;
            }
        }

        current += ch;
    }

    parts.push(current);
    return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Removes one layer of wrapping parentheses, repeatedly, when balanced. */
export function unwrapParens(input: string): string {
    let s = input.trim();
    while (s.startsWith("(") && s.endsWith(")")) {
        let depth = 0;
        let balanced = true;
        let inString = false;
        for (let i = 0; i < s.length; i++) {
            const ch = s[i];
            if (inString) {
                if (ch === "'") {
                    if (s[i + 1] === "'") i++;
                    else inString = false;
                }
                continue;
            }
            if (ch === "'") { inString = true; continue; }
            if (ch === "(") depth++;
            else if (ch === ")") {
                depth--;
                // The opening paren closed before the end, so the outer pair is
                // not a wrapper: `(a) AND (b)`.
                if (depth === 0 && i < s.length - 1) { balanced = false; break; }
            }
        }
        if (!balanced) break;
        s = s.slice(1, -1).trim();
    }
    return s;
}

/** Drops trailing `::type` casts, including array and quoted forms. */
export function stripCasts(input: string): string {
    let s = unwrapParens(input);
    let previous: string;
    do {
        previous = s;
        s = unwrapParens(
            s.replace(/::\s*"?[A-Za-z_][A-Za-z0-9_ ]*"?(\s*\(\s*\d+\s*(,\s*\d+\s*)?\))?(\s*\[\s*\])*\s*$/, "").trim()
        );
    } while (s !== previous);
    return s;
}

/** A bare, unquoted column reference — anything else is an expression. */
function asColumnName(input: string): string | null {
    const s = stripCasts(input);
    if (/^[a-z_][a-z0-9_$]*$/i.test(s)) return s;
    // A quoted identifier keeps its case: "userId".
    const quoted = s.match(/^"([^"]+)"$/);
    return quoted ? quoted[1] : null;
}

/** `length(col)` and friends → the column they measure. */
function asLengthOfColumn(input: string): string | null {
    const s = stripCasts(input);
    const match = s.match(/^([a-z_]+)\s*\((.*)\)$/is);
    if (!match || !LENGTH_FUNCTIONS.has(match[1].toLowerCase())) return null;
    return asColumnName(match[2]);
}

/** A numeric literal, after casts are removed. Rejects anything else. */
function asNumber(input: string): number | null {
    const s = stripCasts(input).replace(/^'(.*)'$/s, "$1");
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

/** A single-quoted string literal, with `''` unescaped. */
function asStringLiteral(input: string): string | null {
    const s = stripCasts(input);
    if (!s.startsWith("'") || !s.endsWith("'") || s.length < 2) return null;
    const body = s.slice(1, -1);
    // Any unescaped quote inside means this was not one literal.
    if (/(^|[^'])'($|[^'])/.test(body)) return null;
    return body.replace(/''/g, "'");
}

/** The element list of `ARRAY[…]`, or of a parenthesised `IN (…)` list. */
function asValueList(input: string): string[] | null {
    const s = stripCasts(input);
    const arrayMatch = s.match(/^ARRAY\s*\[(.*)\]$/is);
    const body = arrayMatch ? arrayMatch[1] : (s.startsWith("(") && s.endsWith(")") ? s.slice(1, -1) : null);
    if (body === null) return null;
    if (body.trim() === "") return null;

    const values: string[] = [];
    for (const element of splitTopLevel(body, ",")) {
        const literal = asStringLiteral(element);
        if (literal !== null) {
            values.push(literal);
            continue;
        }
        const numeric = asNumber(element);
        if (numeric !== null) {
            values.push(String(numeric));
            continue;
        }
        return null; // A non-literal element means this is not an enumeration.
    }
    return values;
}

/** One understood comparison, already resolved to the column it constrains. */
interface CheckTerm {
    column: string;
    apply: (facts: ColumnCheckFacts) => void;
}

/**
 * Parses one conjunct. Returns null when the shape is not one of the few this
 * understands, which is the signal to abandon the whole constraint.
 */
function parseTerm(rawTerm: string): CheckTerm | null {
    const term = unwrapParens(rawTerm);

    // ── Membership: `x = ANY (ARRAY[…])`, `x IN (…)` ──────────────────
    const anyMatch = term.match(/^(.*?)\s*=\s*ANY\s*(\(.*\))$/is);
    const inMatch = anyMatch ? null : term.match(/^(.*?)\s+IN\s*(\(.*\))$/is);
    const membership = anyMatch ?? inMatch;
    if (membership) {
        const column = asColumnName(membership[1]);
        const values = asValueList(membership[2]);
        if (!column || !values || values.length === 0) return null;
        return {
            column,
            apply: (facts) => {
                // Two membership checks on one column mean both must hold.
                facts.enumValues = facts.enumValues
                    ? facts.enumValues.filter((v) => values.includes(v))
                    : values;
            }
        };
    }

    // ── Comparison: `x >= n`, `length(x) <= n`, `x = 'literal'` ───────
    // Longest operators first so `>=` is not read as `>`.
    for (const operator of [">=", "<=", "<>", "!=", "=", ">", "<"] as const) {
        const parts = splitTopLevel(term, operator);
        if (parts.length !== 2) continue;
        const [rawLeft, rawRight] = parts;

        const lengthColumn = asLengthOfColumn(rawLeft);
        if (lengthColumn) {
            const bound = asNumber(rawRight);
            if (bound === null) return null;
            switch (operator) {
                case ">=": return { column: lengthColumn, apply: (f) => { f.lengthMin = Math.max(f.lengthMin ?? bound, bound); } };
                case ">": return { column: lengthColumn, apply: (f) => { f.lengthMin = Math.max(f.lengthMin ?? bound + 1, bound + 1); } };
                case "<=": return { column: lengthColumn, apply: (f) => { f.lengthMax = Math.min(f.lengthMax ?? bound, bound); } };
                case "<": return { column: lengthColumn, apply: (f) => { f.lengthMax = Math.min(f.lengthMax ?? bound - 1, bound - 1); } };
                case "=": return { column: lengthColumn, apply: (f) => { f.lengthMin = bound; f.lengthMax = bound; } };
                default: return null;
            }
        }

        const column = asColumnName(rawLeft);
        if (!column) continue;

        if (operator === "=") {
            const literal = asStringLiteral(rawRight);
            if (literal !== null) {
                return {
                    column,
                    apply: (facts) => {
                        facts.enumValues = facts.enumValues
                            ? facts.enumValues.filter((v) => v === literal)
                            : [literal];
                    }
                };
            }
            // `x = 5` pins a number. Expressed as both bounds rather than as a
            // one-value enum, which for a number would render as a dropdown.
            const pinned = asNumber(rawRight);
            if (pinned === null) return null;
            return { column, apply: (f) => { f.min = pinned; f.max = pinned; } };
        }

        const bound = asNumber(rawRight);
        if (bound === null) return null;
        switch (operator) {
            case ">=": return { column, apply: (f) => { f.min = Math.max(f.min ?? bound, bound); } };
            case ">": return { column, apply: (f) => { f.moreThan = Math.max(f.moreThan ?? bound, bound); } };
            case "<=": return { column, apply: (f) => { f.max = Math.min(f.max ?? bound, bound); } };
            case "<": return { column, apply: (f) => { f.lessThan = Math.min(f.lessThan ?? bound, bound); } };
            default: return null; // `<>` / `!=` exclude rather than bound.
        }
    }

    return null;
}

/**
 * Reads one constraint definition into per-column facts.
 *
 * Returns an empty map for anything not understood — including a constraint
 * that is understood but spans two columns (`start_date < end_date`), which no
 * per-property validation rule can express.
 */
export function parseCheckDefinition(definition: string): Map<string, ColumnCheckFacts> {
    const result = new Map<string, ColumnCheckFacts>();

    const body = definition
        .trim()
        .replace(/\s+NOT\s+VALID\s*$/i, "")
        .replace(/^CHECK\s*/i, "")
        .trim();
    if (body === definition.trim()) return result; // Not a CHECK definition.

    const expression = unwrapParens(body);
    if (!expression) return result;

    // Only conjunctions. A disjunction (`a OR b`) does not narrow a column: each
    // branch may allow what the other forbids, so no single bound follows.
    if (splitTopLevel(expression, " OR ").length > 1) return result;

    const terms = splitTopLevel(expression, " AND ");
    const parsed: CheckTerm[] = [];
    for (const term of terms) {
        const one = parseTerm(term);
        if (!one) return result; // One unreadable conjunct voids the constraint.
        parsed.push(one);
    }

    // A CHECK naming two columns constrains their *relationship*; keeping the
    // half that mentions one column would assert something the database does not.
    const columns = new Set(parsed.map((t) => t.column));
    if (columns.size !== 1) return result;

    const facts: ColumnCheckFacts = {};
    for (const term of parsed) term.apply(facts);
    if (Object.keys(facts).length === 0) return result;

    result.set(parsed[0].column, facts);
    return result;
}

/** Merges every readable CHECK in the schema into per-table, per-column facts. */
export function parseCheckConstraints(rows: CheckConstraintRow[]): CheckFactsByTable {
    const byTable: CheckFactsByTable = new Map();

    for (const row of rows) {
        const parsed = parseCheckDefinition(row.definition);
        if (parsed.size === 0) continue;

        let table = byTable.get(row.table_name);
        if (!table) {
            table = new Map();
            byTable.set(row.table_name, table);
        }

        for (const [column, facts] of parsed) {
            const existing = table.get(column);
            if (!existing) {
                table.set(column, facts);
                continue;
            }
            // Separate constraints on the same column all hold at once.
            if (facts.enumValues) {
                existing.enumValues = existing.enumValues
                    ? existing.enumValues.filter((v) => facts.enumValues!.includes(v))
                    : facts.enumValues;
            }
            if (facts.min !== undefined) existing.min = Math.max(existing.min ?? facts.min, facts.min);
            if (facts.max !== undefined) existing.max = Math.min(existing.max ?? facts.max, facts.max);
            if (facts.moreThan !== undefined) existing.moreThan = Math.max(existing.moreThan ?? facts.moreThan, facts.moreThan);
            if (facts.lessThan !== undefined) existing.lessThan = Math.min(existing.lessThan ?? facts.lessThan, facts.lessThan);
            if (facts.lengthMin !== undefined) existing.lengthMin = Math.max(existing.lengthMin ?? facts.lengthMin, facts.lengthMin);
            if (facts.lengthMax !== undefined) existing.lengthMax = Math.min(existing.lengthMax ?? facts.lengthMax, facts.lengthMax);
        }
    }

    return byTable;
}
