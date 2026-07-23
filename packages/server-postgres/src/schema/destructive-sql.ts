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
}

/**
 * Scan an Atlas plan (the SQL printed by `schema apply --dry-run`) and return
 * the statements that would destroy data. An empty array means the plan is
 * safe to auto-approve.
 */
export function detectDestructiveStatements(planSql: string): DestructiveStatement[] {
    const found: DestructiveStatement[] = [];
    for (const statement of splitSqlStatements(planSql)) {
        for (const { label, re } of DESTRUCTIVE_PATTERNS) {
            if (re.test(statement)) {
                found.push({ statement, kind: label });
                break; // one label per statement is enough to flag it
            }
        }
    }
    return found;
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
