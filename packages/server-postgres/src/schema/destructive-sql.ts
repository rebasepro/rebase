/**
 * Pure helpers that classify an Atlas declarative-apply plan as destructive
 * or not, and decide what `rebase db push` should do about it.
 *
 * `db push` runs `atlas schema apply` to make the live database match the
 * generated `schema.sql`. Removing a collection field compiles to
 * `DROP COLUMN`; renaming compiles to drop-then-add — either destroys data.
 * We first run the apply with `--dry-run` to obtain the planned SQL, scan it
 * here, and refuse to auto-approve anything destructive without an explicit
 * opt-in.
 *
 * A type change is the one destructive plan that names no DROP. `ALTER COLUMN
 * "price" TYPE integer` rounds every 19.99 to 20, and `TYPE date` throws away
 * every timestamp's time of day, in a statement that reads like a routine
 * alter. So a type change is gated too, unless it is a widening every value
 * survives unchanged — which needs the column's current type, read from the
 * catalogue by the caller.
 *
 * Everything in this file is side-effect free so it can be unit-tested
 * without Atlas or a database.
 */

/**
 * SQL fragments that destroy data or data-bearing objects. Matched
 * case-insensitively against each statement of the plan. `IF EXISTS` /
 * whitespace variations are tolerated by the regexes below.
 */
const DESTRUCTIVE_PATTERNS: { label: string; re: RegExp }[] = [
    { label: "DROP TABLE", re: /\bDROP\s+TABLE\b/i },
    { label: "DROP COLUMN", re: /\bDROP\s+COLUMN\b/i },
    { label: "DROP SCHEMA", re: /\bDROP\s+SCHEMA\b/i },
    { label: "DROP VIEW", re: /\bDROP\s+(MATERIALIZED\s+)?VIEW\b/i },
    { label: "DROP TYPE", re: /\bDROP\s+TYPE\b/i },
    { label: "TRUNCATE", re: /\bTRUNCATE\b/i }
];

/**
 * Split a SQL script into individual statements, dropping blank lines and
 * `--` comment lines. Deliberately simple: Atlas emits one plain statement
 * per `;`, without string literals that contain semicolons in a schema DDL
 * plan, so a naive split is safe and keeps this dependency-free.
 */
export function splitSqlStatements(sql: string): string[] {
    // Strip full-line SQL comments so a commented-out DROP never trips the
    // detector, then split on semicolons.
    const withoutComments = sql
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
    return withoutComments
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}

export interface DestructiveStatement {
    /** The offending statement (trimmed, without the trailing `;`). */
    statement: string;
    /** Which destructive operation it was flagged for, e.g. "DROP COLUMN". */
    kind: string;
    /**
     * What in the statement loses data, when the kind alone does not say:
     * for `ALTER COLUMN TYPE`, each lossy column with its old and new type.
     */
    detail?: string;
}

/** A column as the database has it now, with its type as `format_type` spells it. */
export interface ExistingColumnType {
    schema: string;
    table: string;
    column: string;
    /** e.g. `character varying(255)`, `numeric(10,2)`, `timestamp with time zone`. */
    type: string;
}

/**
 * Every column of every ordinary table outside the system schemas, with its
 * type. What {@link detectDestructiveStatements} compares a planned type
 * change against; `format_type` because it carries the modifier (`(255)`,
 * `(10,2)`) that decides whether a change widens or narrows.
 */
export const COLUMN_TYPES_SQL = `
    SELECT n.nspname AS "schema",
           c.relname AS "table",
           a.attname AS "column",
           format_type(a.atttypid, a.atttypmod) AS "type"
    FROM pg_attribute a
    JOIN pg_class c     ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p')
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg\\_%'
`;

/**
 * Scan an Atlas plan (the SQL printed by `schema apply --dry-run`) and return
 * the statements that would destroy data. An empty array means the plan is
 * safe to auto-approve.
 *
 * `columnTypes` is what the database holds now. A type change to a column it
 * does not list is flagged: not knowing what a column is means not knowing
 * whether the change keeps its values.
 */
export function detectDestructiveStatements(
    planSql: string,
    columnTypes: readonly ExistingColumnType[] = []
): DestructiveStatement[] {
    const found: DestructiveStatement[] = [];
    for (const statement of splitSqlStatements(planSql)) {
        const dropped = DESTRUCTIVE_PATTERNS.find(({ re }) => re.test(statement));
        if (dropped) {
            found.push({ statement, kind: dropped.label });
            continue; // one label per statement is enough to flag it
        }
        const lossy = parseColumnTypeChanges(statement)
            .map(change => ({ change, from: currentTypeOf(change, columnTypes) }))
            .filter(({ change, from }) => from === undefined || !isLosslessTypeChange(from, change.to));
        if (lossy.length > 0) {
            found.push({
                statement,
                kind: "ALTER COLUMN TYPE",
                detail: lossy
                    .map(({ change, from }) => `"${change.column}" ${from ?? "(current type unknown)"} → ${change.to}`)
                    .join("; ")
            });
        }
    }
    return found;
}

/** A column an `ALTER TABLE` retypes, with the type the plan gives it. */
interface ColumnTypeChange {
    /** Absent when the plan did not qualify the table. */
    schema?: string;
    table: string;
    column: string;
    /** As the plan writes it, without any `USING` or `COLLATE`. */
    to: string;
}

const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const ALTER_TABLE_RE = new RegExp(
    String.raw`^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${IDENT})(?:\.(${IDENT}))?\s+([\s\S]*)$`, "i"
);
const TYPE_CLAUSE_RE = new RegExp(
    String.raw`^ALTER\s+(?:COLUMN\s+)?(${IDENT})\s+(?:SET\s+DATA\s+)?TYPE\s+([\s\S]+)$`, "i"
);

const unquote = (ident: string): string =>
    ident.startsWith("\"") ? ident.slice(1, -1).replace(/""/g, "\"") : ident;

/**
 * Split an `ALTER TABLE`'s clause list on its top-level commas — the ones
 * outside parentheses and quotes, so `TYPE numeric(10, 2)` stays one clause.
 */
function splitClauses(body: string): string[] {
    const clauses: string[] = [];
    let depth = 0;
    let quote: string | undefined;
    let start = 0;
    for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (quote) {
            if (ch === quote) quote = undefined;
        } else if (ch === "\"" || ch === "'") {
            quote = ch;
        } else if (ch === "(") {
            depth++;
        } else if (ch === ")") {
            depth--;
        } else if (ch === "," && depth === 0) {
            clauses.push(body.slice(start, i).trim());
            start = i + 1;
        }
    }
    clauses.push(body.slice(start).trim());
    return clauses.filter(clause => clause.length > 0);
}

/**
 * Every `ALTER COLUMN … [SET DATA] TYPE` in one statement. Atlas prints its
 * dry-run statements under a `-> ` marker and puts several clauses in one
 * `ALTER TABLE`, so both are handled.
 */
function parseColumnTypeChanges(statement: string): ColumnTypeChange[] {
    const table = ALTER_TABLE_RE.exec(statement.replace(/^\s*->\s*/, "").trim());
    if (!table) return [];
    const [schema, name] = table[2]
        ? [unquote(table[1]), unquote(table[2])]
        : [undefined, unquote(table[1])];
    const changes: ColumnTypeChange[] = [];
    for (const clause of splitClauses(table[3])) {
        const match = TYPE_CLAUSE_RE.exec(clause);
        if (!match) continue;
        const to = match[2].split(/\s+(?:USING|COLLATE)\s/i)[0].trim();
        changes.push({ schema, table: name, column: unquote(match[1]), to });
    }
    return changes;
}

/**
 * The column's current type. A table named without its schema matches in any
 * schema, but only when every match agrees — two same-named tables with
 * different types leave the answer unknown.
 */
function currentTypeOf(change: ColumnTypeChange, columnTypes: readonly ExistingColumnType[]): string | undefined {
    const types = new Set(columnTypes
        .filter(col => col.table === change.table && col.column === change.column
            && (change.schema === undefined || col.schema === change.schema))
        .map(col => col.type));
    return types.size === 1 ? [...types][0] : undefined;
}

/** Spellings of one type, mapped to one name. Anything absent compares verbatim. */
const TYPE_ALIASES: Record<string, string> = {
    "int": "integer",
    "int4": "integer",
    "int2": "smallint",
    "int8": "bigint",
    "character varying": "varchar",
    "decimal": "numeric",
    "timestamp without time zone": "timestamp",
    "timestamp with time zone": "timestamptz",
    "time without time zone": "time",
    "time with time zone": "timetz",
    "bool": "boolean",
    "float4": "real",
    "float8": "double precision",
    "character": "bpchar",
    "char": "bpchar"
};

/** Decimal digits each integer type holds, which is what a `numeric` must hold too. */
const INTEGER_DIGITS: Record<string, number> = { smallint: 5, integer: 10, bigint: 19 };

/** Types whose modifier is a fractional-seconds precision, 6 when absent. */
const SECONDS_PRECISION = new Set(["timestamp", "timestamptz", "time", "timetz"]);

interface ParsedType {
    base: string;
    /** The modifier, e.g. `[10, 2]` for `numeric(10,2)`. */
    args?: number[];
    /** Array dimensions. */
    dims: number;
}

function parseType(raw: string): ParsedType {
    let text = raw.trim().replace(/\s+/g, " ");
    let dims = 0;
    for (let suffix = /\s*\[\d*\]$/.exec(text); suffix; suffix = /\s*\[\d*\]$/.exec(text)) {
        dims++;
        text = text.slice(0, suffix.index);
    }
    // A quoted name is a user-defined type, compared exactly as written.
    if (text.includes("\"")) return { base: text, dims };
    text = text.toLowerCase().replace(/^pg_catalog\./, "");
    let args: number[] | undefined;
    const modifier = /\(([^)]*)\)/.exec(text);
    if (modifier) {
        args = modifier[1].split(",").map(part => Number(part.trim()));
        text = `${text.slice(0, modifier.index)} ${text.slice(modifier.index + modifier[0].length)}`
            .replace(/\s+/g, " ")
            .trim();
    }
    return { base: TYPE_ALIASES[text] ?? text, args, dims };
}

/** Does moving from one modifier to another, on the same type, keep every value? */
function modifierWidens(base: string, from: number[] | undefined, to: number[] | undefined): boolean {
    if (JSON.stringify(from) === JSON.stringify(to)) return true;
    if (base === "varchar") {
        return to === undefined || (from !== undefined && to[0] >= from[0]);
    }
    if (base === "numeric") {
        if (to === undefined) return true;
        if (from === undefined) return false;
        const [p1, s1 = 0] = from;
        const [p2, s2 = 0] = to;
        return s2 >= s1 && p2 - s2 >= p1 - s1;
    }
    if (SECONDS_PRECISION.has(base)) {
        return (to?.[0] ?? 6) >= (from?.[0] ?? 6);
    }
    return false;
}

/**
 * Is `ALTER COLUMN … TYPE to` a widening, one that keeps every value exactly
 * as it was?
 *
 * Deliberately short. Everything not listed needs a confirmation, including
 * changes that are usually harmless: `timestamp` → `timestamptz` reads each
 * value in the session's time zone, `json` → `jsonb` drops duplicate keys,
 * `real` → `double precision` prints 0.1 as 0.100000001490116, and `integer` →
 * `text` keeps the digits but changes what the column is.
 *
 *  - the same type, with a modifier at least as wide (`varchar(100)` →
 *    `varchar(255)`, `numeric(10,2)` → `numeric(12,2)` or unbounded,
 *    `timestamptz(3)` → `timestamptz`);
 *  - `smallint` → `integer` → `bigint`, and any of them to a `numeric` with
 *    room for all their digits;
 *  - `varchar(n)` → `text`, and `text` → an unbounded `varchar`.
 *
 * Arrays follow their element type, and never gain or lose a dimension.
 */
export function isLosslessTypeChange(from: string, to: string): boolean {
    const a = parseType(from);
    const b = parseType(to);
    if (a.dims !== b.dims) return false;
    if (a.args?.some(Number.isNaN) || b.args?.some(Number.isNaN)) return false;
    if (a.base === b.base) return modifierWidens(a.base, a.args, b.args);

    const fromDigits = INTEGER_DIGITS[a.base];
    if (fromDigits !== undefined) {
        const toDigits = INTEGER_DIGITS[b.base];
        if (toDigits !== undefined) return toDigits >= fromDigits;
        if (b.base === "numeric") {
            return b.args === undefined || b.args[0] - (b.args[1] ?? 0) >= fromDigits;
        }
        return false;
    }
    if (a.base === "varchar" && b.base === "text") return true;
    if (a.base === "text" && b.base === "varchar") return b.args === undefined;
    return false;
}

export type PushDecision = "apply" | "confirm" | "refuse";

/**
 * Decide how `db push` should proceed given the plan's destructiveness and
 * the invocation context.
 *
 *  - No destructive statements → `apply` (safe to auto-approve).
 *  - Destructive + `--allow-destructive` → `apply` (operator opted in).
 *  - Destructive + interactive TTY → `confirm` (prompt before applying).
 *  - Destructive + non-interactive → `refuse` (never silently drop data in
 *    CI / scripts / agents).
 */
export function decidePushSafety(opts: {
    destructiveCount: number;
    allowDestructive: boolean;
    interactive: boolean;
}): PushDecision {
    if (opts.destructiveCount === 0) return "apply";
    if (opts.allowDestructive) return "apply";
    return opts.interactive ? "confirm" : "refuse";
}
