/**
 * Keep the objects Rebase carved out of Atlas's view out of the migrations
 * Atlas writes.
 *
 * `db push` protects them with `--exclude`. `atlas migrate diff` has no such
 * flag — measured on the pinned 1.2.3, `--exclude` is rejected outright with
 * `unknown flag`, and the `exclude` attribute of an `atlas.hcl` `env` block is
 * accepted and then silently ignored on that path. So the diff sees the search
 * column that the migration directory's own appended DDL created when it
 * replayed, does not see it in `schema.sql`, and plans a drop:
 *
 *     ALTER TABLE "public"."talents" DROP COLUMN "search_vector";
 *
 * That statement is removed here, after Atlas has written the file and before
 * anything is appended to it — so the input is always Atlas's own plain output,
 * never the dollar-quoted helper bodies that get appended afterwards.
 *
 * The drop does not arrive alone. Atlas folds every change to one table into a
 * single statement, so a real edit in the same run produces
 *
 *     ALTER TABLE "public"."talents"
 *         DROP COLUMN "search_vector", DROP COLUMN "interests", ADD COLUMN "headline" text NULL;
 *
 * and dropping the whole statement would silently throw away a migration the
 * project asked for. The removal is therefore per *clause*.
 *
 * Fail-safe throughout: a statement that mentions a carved-out object but does
 * not match a shape this understands is left exactly as it is and reported as
 * `unhandled`, so the caller can say so out loud. A spurious drop the developer
 * can see beats a migration quietly rewritten wrong.
 */

/** Anything Postgres accepts in an unquoted identifier past ASCII. */
const IDENT = "(?:\"(?:[^\"]|\"\")*\"|[A-Za-z_\\u0080-\\uffff][\\w$\\u0080-\\uffff]*)";
const QUALIFIED = `${IDENT}(?:\\s*\\.\\s*${IDENT})*`;

const ALTER_TABLE_RE = new RegExp(`^ALTER\\s+TABLE\\s+(?:ONLY\\s+)?(${QUALIFIED})\\s+([\\s\\S]+)$`, "i");
const DROP_COLUMN_RE = new RegExp(`^DROP\\s+(?:COLUMN\\s+)?(?:IF\\s+EXISTS\\s+)?(${IDENT})$`, "i");
const DROP_INDEX_RE = new RegExp(`^DROP\\s+INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+EXISTS\\s+)?(${QUALIFIED})$`, "i");

/**
 * Does this statement destroy anything at all?
 *
 * The gate on reporting. A statement that merely *names* a carved-out object —
 * `COMMENT ON COLUMN … "search_vector"` — is not a problem and must not be
 * reported as one, because an unrewritable drop stops the caller outright.
 */
const MENTIONS_DROP = /\bDROP\b/i;

/** One `schema.table.object` exclude pattern, taken apart. */
export interface CarvedOutObject {
    schema: string;
    table: string;
    object: string;
}

export interface StripResult {
    /** The migration text with the carved-out clauses gone. */
    sql: string;
    /** What was removed, as SQL fragments, for reporting. */
    removed: string[];
    /**
     * Statements naming a carved-out object that this could not rewrite with
     * confidence. Left untouched in `sql`.
     */
    unhandled: string[];
    /** True when nothing but comments and whitespace survives. */
    empty: boolean;
}

/**
 * Split `schema.table.object` patterns. Anything not in three parts is
 * ignored rather than guessed at — the two-part form is the one Atlas itself
 * silently mis-reads, and repeating that mistake here would be worse than
 * doing nothing.
 */
export function parseExcludePatterns(patterns: string[]): CarvedOutObject[] {
    const parsed: CarvedOutObject[] = [];
    for (const pattern of patterns) {
        const parts = pattern.split(".");
        if (parts.length !== 3) continue;
        if (parts.some((p) => p.length === 0)) continue;
        parsed.push({ schema: parts[0], table: parts[1], object: parts[2] });
    }
    return parsed;
}

/** `"public"` and `public` are the same name; `"Public"` is not `public`. */
function unquoteIdentifier(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed.startsWith("\"") && trimmed.endsWith("\"") && trimmed.length >= 2) {
        return trimmed.slice(1, -1).replace(/""/g, "\"");
    }
    // An unquoted identifier is folded to lower case by Postgres.
    return trimmed.toLowerCase();
}

/** Split a dotted identifier at its top-level dots, respecting quoting. */
function splitQualifiedName(raw: string): string[] | null {
    const parts: string[] = [];
    let current = "";
    let inQuote = false;
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (inQuote) {
            if (ch === "\"") {
                if (raw[i + 1] === "\"") { current += "\"\""; i++; continue; }
                inQuote = false;
            }
            current += ch;
            continue;
        }
        if (ch === "\"") { inQuote = true; current += ch; continue; }
        if (ch === ".") { parts.push(current); current = ""; continue; }
        current += ch;
    }
    if (inQuote) return null;
    parts.push(current);
    return parts.map(unquoteIdentifier);
}

/**
 * One statement located in the source text, with the comment lines that
 * introduce it. Atlas writes `-- Modify "talents" table` above each statement;
 * removing the statement without its comment leaves a caption over nothing.
 */
interface LocatedStatement {
    /** Offset of the first character of the leading comment block. */
    start: number;
    /** Offset just past the terminating semicolon. */
    end: number;
    /** Offset of the first character of the statement itself. */
    bodyStart: number;
    /** The statement without its leading comments or trailing semicolon. */
    body: string;
}

/**
 * Walk the script and locate every statement. Quote-, comment- and
 * dollar-aware: the appended halves of a migration are not passed here, but a
 * splitter that shreds a `DO $tag$ ... $tag$` block is a trap worth not
 * leaving behind — it is how the derived-names renderer broke.
 *
 * Returns null if the text ends inside a quote or a dollar-quoted body, or
 * trails off in a statement with no semicolon. Either means this cannot be
 * reasoned about safely.
 */
function locateStatements(sql: string): LocatedStatement[] | null {
    const statements: LocatedStatement[] = [];
    let i = 0;
    let statementStart = 0;
    let sawCode = false;

    const pushStatement = (endExclusive: number) => {
        const leading = sql.slice(statementStart, endExclusive);
        // The leading run of comment/blank lines belongs to this statement.
        let consumed = 0;
        for (const line of leading.split("\n")) {
            const trimmed = line.trim();
            if (trimmed === "" || trimmed.startsWith("--")) {
                consumed += line.length + 1;
                continue;
            }
            break;
        }
        const bodyStart = statementStart + consumed;
        statements.push({
            start: statementStart,
            end: endExclusive,
            bodyStart,
            body: sql.slice(bodyStart, endExclusive).replace(/;\s*$/, "").trim()
        });
    };

    while (i < sql.length) {
        const ch = sql[i];

        if (ch === "-" && sql[i + 1] === "-") {
            const nl = sql.indexOf("\n", i);
            i = nl === -1 ? sql.length : nl + 1;
            continue;
        }
        if (ch === "/" && sql[i + 1] === "*") {
            const close = sql.indexOf("*/", i + 2);
            if (close === -1) return null;
            i = close + 2;
            sawCode = true;
            continue;
        }
        if (ch === "'" || ch === "\"") {
            const quote = ch;
            i++;
            let closed = false;
            while (i < sql.length) {
                if (sql[i] === quote) {
                    if (sql[i + 1] === quote) { i += 2; continue; }
                    i++;
                    closed = true;
                    break;
                }
                i++;
            }
            if (!closed) return null;
            sawCode = true;
            continue;
        }
        if (ch === "$") {
            const tag = /^\$(?:[A-Za-z_\u0080-\uffff][\w\u0080-\uffff]*)?\$/.exec(sql.slice(i));
            if (tag) {
                const close = sql.indexOf(tag[0], i + tag[0].length);
                if (close === -1) return null;
                i = close + tag[0].length;
                sawCode = true;
                continue;
            }
        }
        if (ch === ";") {
            pushStatement(i + 1);
            i++;
            statementStart = i;
            sawCode = false;
            continue;
        }
        if (!/\s/.test(ch)) sawCode = true;
        i++;
    }

    // Trailing text with no semicolon: only comments and whitespace is fine.
    if (sawCode) return null;
    return statements;
}

/** Split an ALTER TABLE action list at its top-level commas. */
function splitClauses(actions: string): string[] | null {
    const clauses: string[] = [];
    let depth = 0;
    let current = "";
    let i = 0;
    while (i < actions.length) {
        const ch = actions[i];
        if (ch === "'" || ch === "\"") {
            const quote = ch;
            current += ch;
            i++;
            let closed = false;
            while (i < actions.length) {
                current += actions[i];
                if (actions[i] === quote) {
                    if (actions[i + 1] === quote) { current += actions[i + 1]; i += 2; continue; }
                    i++;
                    closed = true;
                    break;
                }
                i++;
            }
            if (!closed) return null;
            continue;
        }
        if (ch === "(") { depth++; current += ch; i++; continue; }
        if (ch === ")") { depth--; current += ch; i++; continue; }
        if (ch === "," && depth === 0) { clauses.push(current); current = ""; i++; continue; }
        current += ch;
        i++;
    }
    if (depth !== 0) return null;
    clauses.push(current);
    return clauses.map((c) => c.trim()).filter((c) => c.length > 0);
}

/**
 * Remove every clause and statement that would drop one of `patterns`.
 *
 * `patterns` are the `schema.table.object` strings the CLI already builds for
 * Atlas's `--exclude`, so the diff path and the apply path protect exactly the
 * same set by construction.
 */
export function stripCarvedOutStatements(migrationSql: string, patterns: string[]): StripResult {
    const carved = parseExcludePatterns(patterns);
    if (carved.length === 0) {
        return { sql: migrationSql, removed: [], unhandled: [], empty: isBlank(migrationSql) };
    }

    const located = locateStatements(migrationSql);
    if (located === null) {
        // Nothing can be trusted about the offsets, so nothing moves. Worth
        // stopping the caller over only if one of ours is being dropped in
        // there; otherwise this file has nothing to do with us.
        const atStake = MENTIONS_DROP.test(migrationSql)
            && carved.some((c) => migrationSql.includes(c.object));
        return {
            sql: migrationSql,
            removed: [],
            unhandled: atStake ? [migrationSql.trim()] : [],
            empty: isBlank(migrationSql)
        };
    }

    const removed: string[] = [];
    const unhandled: string[] = [];
    // Edits as [start, end) → replacement, applied back-to-front so the
    // offsets of the ones still pending stay valid.
    const edits: { start: number; end: number; replacement: string }[] = [];

    for (const statement of located) {
        if (!carved.some((c) => statement.body.includes(c.object))) continue;

        const dropIndex = DROP_INDEX_RE.exec(statement.body);
        if (dropIndex) {
            const parts = splitQualifiedName(dropIndex[1]);
            const name = parts?.[parts.length - 1];
            const schema = parts && parts.length > 1 ? parts[parts.length - 2] : undefined;
            if (name !== undefined && carved.some((c) =>
                c.object === name && (schema === undefined || c.schema === schema))) {
                removed.push(statement.body);
                edits.push({ start: statement.start, end: statement.end, replacement: "" });
            } else {
                // A near-miss on the name — some other index whose name
                // contains ours. Left alone, and still a drop, so still
                // reported.
                unhandled.push(statement.body);
            }
            continue;
        }

        // Anything else naming a carved-out object is only our business if it
        // destroys something. `COMMENT ON COLUMN … "search_vector"` does not.
        const alter = ALTER_TABLE_RE.exec(statement.body);
        if (!alter) {
            if (MENTIONS_DROP.test(statement.body)) unhandled.push(statement.body);
            continue;
        }

        const target = splitQualifiedName(alter[1]);
        if (!target) {
            if (MENTIONS_DROP.test(statement.body)) unhandled.push(statement.body);
            continue;
        }
        const table = target[target.length - 1];
        const schema = target.length > 1 ? target[target.length - 2] : undefined;

        const clauses = splitClauses(alter[2]);
        if (!clauses) {
            if (MENTIONS_DROP.test(statement.body)) unhandled.push(statement.body);
            continue;
        }

        const survivors: string[] = [];
        let removedHere = 0;
        let unhandledHere = false;
        for (const clause of clauses) {
            const drop = DROP_COLUMN_RE.exec(clause);
            const column = drop ? unquoteIdentifier(drop[1]) : undefined;
            const isCarved = column !== undefined && carved.some((c) =>
                c.object === column &&
                c.table === table &&
                (schema === undefined || c.schema === schema));
            if (isCarved) {
                removed.push(`ALTER TABLE ${alter[1]}: ${clause}`);
                removedHere++;
                continue;
            }
            // A clause naming a carved-out object in some other shape is not
            // something to guess at — if it destroys it.
            if (MENTIONS_DROP.test(clause) && carved.some((c) => clause.includes(c.object))) {
                unhandledHere = true;
            }
            survivors.push(clause);
        }

        if (unhandledHere) unhandled.push(statement.body);
        if (removedHere === 0) continue;

        if (survivors.length === 0) {
            edits.push({ start: statement.start, end: statement.end, replacement: "" });
        } else {
            edits.push({
                start: statement.bodyStart,
                end: statement.end,
                replacement: `ALTER TABLE ${alter[1]} ${survivors.join(", ")};`
            });
        }
    }

    let sql = migrationSql;
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
        sql = sql.slice(0, edit.start) + edit.replacement + sql.slice(edit.end);
    }
    if (edits.length > 0) sql = tidy(sql);

    return { sql, removed, unhandled, empty: isBlank(sql) };
}

/** Only comments and whitespace left — nothing a migration would do. */
function isBlank(sql: string): boolean {
    return sql
        .split("\n")
        .every((line) => line.trim() === "" || line.trim().startsWith("--"));
}

/** Collapse the blank runs an excision leaves behind. */
function tidy(sql: string): string {
    const trimmed = sql.replace(/\n{3,}/g, "\n\n").replace(/^\s*\n/, "").trimEnd();
    return trimmed.length === 0 ? "" : `${trimmed}\n`;
}
