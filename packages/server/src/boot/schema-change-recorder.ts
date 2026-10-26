/**
 * The schema changes a provisioning run made, written down as the SQL script a
 * change process reviews and applies.
 *
 * ## Why a recording, not a plan
 *
 * The obvious tool is a dry run: compute the DDL boot would execute against a
 * database, print it, execute nothing. Rebase's bootstraps cannot be planned
 * that way. Each one reads what it just created — the auth bootstrap
 * introspects the users table it made a statement earlier to choose the type of
 * every foreign key after it; the stores probe their own tables before they
 * revoke on them — so a run that executes nothing takes different branches from
 * one that executes everything, and a plan computed from it would be a guess
 * dressed as an answer.
 *
 * So the run is real, and it is recorded. Against an empty scratch database the
 * script is the whole schema this release needs; against a restored copy of
 * production it is exactly the upgrade, because every branch saw the state it
 * will see there. Either way it is a list of statements that ran and succeeded,
 * in order — which is a claim a reviewer can check, where a plan is a claim
 * about code.
 *
 * ## What is recorded
 *
 * Statements that change the database's structure or privileges
 * ({@link isSchemaChange}): that is what a change process controls. Rows the
 * run writes — the first admin account, version stamps, a backfill — are not
 * schema, and the first of those carries a password hash that has no business
 * in a file that is attached to a ticket.
 *
 * Captured at the pool, below every driver abstraction: each connection checked
 * out of a recorded pool reports the statements it completed. That is the one
 * place every path converges — Drizzle, the SQL admin, a dedicated index-build
 * session — so nothing needs to remember to report itself.
 */
import { isSchemaChange, withoutLeadingComments } from "./ddl-bootstrap";
import type { PoolConnect } from "../metrics/pool-wait";

/** `pg.Client#query`, which takes its arguments in several shapes. */
type QueryFunction = (...args: unknown[]) => unknown;

/** A connection whose statements can be observed. */
interface Queryable {
    query: QueryFunction;
}

function isQueryable(value: unknown): value is Queryable {
    return typeof value === "object" && value !== null && "query" in value && typeof value.query === "function";
}

/** The SQL text of a `query` call: a string, or a `{ text }` config object. */
function statementText(first: unknown): string | undefined {
    if (typeof first === "string") return first;
    if (typeof first === "object" && first !== null && "text" in first && typeof first.text === "string") {
        return first.text;
    }
    return undefined;
}

/** A node-style completion callback, the last argument of `query`'s callback form. */
type QueryCallback = (err: unknown, result: unknown) => unknown;

function isQueryCallback(value: unknown): value is QueryCallback {
    return typeof value === "function";
}

/** Whether a promise-like came back, the shape `query` has without a callback. */
function isThenable(value: unknown): value is PromiseLike<unknown> {
    return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
}

/**
 * Split a query string into its statements, at every `;` that is not inside a
 * string, a quoted identifier, a dollar-quoted body or a comment.
 *
 * Boot sends several statements as one string — `SET LOCAL lock_timeout`, then
 * a table and its indexes, committed together — so a recording that looked
 * only at the first word of each query would miss every table it made that
 * way. Dollar quotes are the case that matters: a `DO` block or a function
 * body is full of semicolons that end nothing.
 */
export function splitStatements(sqlText: string): string[] {
    const statements: string[] = [];
    let start = 0;
    let i = 0;
    const push = (end: number) => {
        const statement = withoutLeadingComments(sqlText.slice(start, end)).trim();
        if (statement !== "") statements.push(statement);
    };
    while (i < sqlText.length) {
        const char = sqlText[i];
        const next = sqlText[i + 1];
        if (char === "-" && next === "-") {
            const end = sqlText.indexOf("\n", i);
            i = end === -1 ? sqlText.length : end + 1;
        } else if (char === "/" && next === "*") {
            const end = sqlText.indexOf("*/", i + 2);
            i = end === -1 ? sqlText.length : end + 2;
        } else if (char === "'" || char === "\"") {
            // A doubled quote is an escaped one; either way the string goes on.
            let j = i + 1;
            while (j < sqlText.length) {
                if (sqlText[j] === char) {
                    if (sqlText[j + 1] === char) { j += 2; continue; }
                    break;
                }
                j++;
            }
            i = j + 1;
        } else if (char === "$") {
            // Not inside an identifier: `a$b$` is a name, where `$b$` would be a tag.
            const inIdentifier = i > 0 && /[A-Za-z0-9_]/.test(sqlText[i - 1]);
            const tag = inIdentifier ? undefined : sqlText.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
            if (tag) {
                const end = sqlText.indexOf(tag, i + tag.length);
                i = end === -1 ? sqlText.length : end + tag.length;
            } else {
                i++;
            }
        } else if (char === ";") {
            push(i);
            start = i + 1;
            i++;
        } else {
            i++;
        }
    }
    push(sqlText.length);
    return statements;
}

/** What a statement does to the transaction it runs in, if anything. */
type TransactionStep =
    | { kind: "begin" }
    | { kind: "commit" }
    | { kind: "rollback" }
    | { kind: "savepoint"; name: string }
    | { kind: "release"; name: string }
    | { kind: "rollback-to"; name: string };

function transactionStep(statement: string): TransactionStep | undefined {
    const words = withoutLeadingComments(statement).split(/\s+/).map(word => word.replace(/;$/, ""));
    const [first, second, third] = words.map(word => word.toUpperCase());
    const name = (word: string | undefined) => (word ?? "").replace(/^"|"$/g, "").toLowerCase();
    if (first === "BEGIN" || (first === "START" && second === "TRANSACTION")) return { kind: "begin" };
    if (first === "COMMIT" || first === "END") return second === "PREPARED" ? undefined : { kind: "commit" };
    if (first === "ROLLBACK" || first === "ABORT") {
        if (second === "TO") return { kind: "rollback-to", name: name(third === "SAVEPOINT" ? words[3] : words[2]) };
        return second === "PREPARED" ? undefined : { kind: "rollback" };
    }
    if (first === "SAVEPOINT") return { kind: "savepoint", name: name(words[1]) };
    if (first === "RELEASE") return { kind: "release", name: name(second === "SAVEPOINT" ? words[2] : words[1]) };
    return undefined;
}

/**
 * One connection's view of what it has done: schema changes it made inside a
 * transaction are held until that transaction commits, and dropped if it rolls
 * back — a probe that tries a change and rolls it away must not reach the
 * script.
 */
class ConnectionLedger {
    private open: string[] | undefined;
    private savepoints: { name: string; at: number }[] = [];

    constructor(private readonly commit: (statements: string[]) => void) {}

    /** Account for one query that succeeded. */
    completed(sqlText: string): void {
        for (const statement of splitStatements(sqlText)) {
            const step = transactionStep(statement);
            if (step) {
                this.apply(step);
            } else if (isSchemaChange(statement)) {
                if (this.open) this.open.push(statement);
                else this.commit([statement]);
            }
        }
    }

    private apply(step: TransactionStep): void {
        switch (step.kind) {
            case "begin":
                this.open ??= [];
                return;
            case "commit":
                if (this.open) this.commit(this.open);
                this.open = undefined;
                this.savepoints = [];
                return;
            case "rollback":
                this.open = undefined;
                this.savepoints = [];
                return;
            case "savepoint":
                if (this.open) this.savepoints.push({ name: step.name, at: this.open.length });
                return;
            case "release": {
                const index = this.savepoints.map(s => s.name).lastIndexOf(step.name);
                if (index !== -1) this.savepoints.splice(index);
                return;
            }
            case "rollback-to": {
                const savepoint = [...this.savepoints].reverse().find(s => s.name === step.name);
                if (this.open && savepoint) this.open.splice(savepoint.at);
                return;
            }
        }
    }
}

export interface SchemaChangeRecorder {
    /** Every schema change completed so far, in the order the database finished them. */
    statements(): string[];
    /** Stop recording. The pools keep working exactly as before. */
    stop(): void;
}

/**
 * Record every schema change completed on connections checked out of `pools`.
 *
 * Wraps `connect` on each pool object, and `query` on each connection it hands
 * out — never a prototype, so nothing outside these pools is touched. Must be
 * installed before the first statement: a `pg.Pool` connects lazily, so a pool
 * that has just been created has nothing open yet, and `pool.query` checks out
 * through `connect` like everything else.
 */
export function recordSchemaChanges(pools: ReadonlyArray<{ connect?: PoolConnect }>): SchemaChangeRecorder {
    const recorded: string[] = [];
    let active = true;
    const wrapped = new WeakSet<object>();

    const observe = (client: unknown): void => {
        if (!isQueryable(client) || wrapped.has(client)) return;
        wrapped.add(client);
        const ledger = new ConnectionLedger(statements => {
            if (active) recorded.push(...statements);
        });
        const note = (text: string | undefined): void => {
            if (text !== undefined) ledger.completed(text);
        };
        const original = client.query;
        client.query = function recordedQuery(this: unknown, ...args: unknown[]): unknown {
            const text = statementText(args[0]);
            const last = args[args.length - 1];
            if (isQueryCallback(last)) {
                // The callback form, which `pool.query` uses internally.
                args[args.length - 1] = (err: unknown, result: unknown) => {
                    if (!err) note(text);
                    return last(err, result);
                };
                return original.apply(this, args);
            }
            const out = original.apply(this, args);
            if (isThenable(out)) {
                return out.then(result => {
                    note(text);
                    return result;
                });
            }
            return out;
        };
    };

    for (const pool of pools) {
        const connect = pool.connect;
        if (typeof connect !== "function") continue;
        pool.connect = function recordedConnect(this: unknown, callback?: Parameters<PoolConnect>[0]) {
            if (typeof callback === "function") {
                return connect.call(this, (err, client, done) => {
                    if (!err) observe(client);
                    callback(err, client, done);
                });
            }
            const checkout = connect.call(this);
            return checkout === undefined
                ? checkout
                : checkout.then(client => {
                    observe(client);
                    return client;
                });
        };
    }

    return {
        statements: () => [...recorded],
        stop: () => { active = false; }
    };
}

/**
 * Strip the indentation a statement carries from the template literal it was
 * written in, so the script reads as SQL rather than as source code.
 */
function dedent(statement: string): string {
    const lines = statement.replace(/^\s*\n/, "").replace(/\s+$/, "").split("\n");
    const indents = lines
        .slice(1)
        .filter(line => line.trim() !== "")
        .map(line => line.match(/^[ \t]*/)?.[0].length ?? 0);
    const strip = indents.length > 0 ? Math.min(...indents) : 0;
    return lines
        .map((line, index) => index === 0 ? line.trim() : line.slice(Math.min(strip, line.match(/^[ \t]*/)?.[0].length ?? 0)))
        .join("\n");
}

/** One statement, terminated exactly once. */
function terminated(statement: string): string {
    const text = dedent(statement);
    return text.endsWith(";") ? text : `${text};`;
}

/** Where the run happened, for the script's header — never the credentials. */
export function describeDatabase(connectionString: string | undefined): string | undefined {
    if (!connectionString) return undefined;
    try {
        const url = new URL(connectionString);
        const database = url.pathname.replace(/^\//, "");
        return `${url.hostname}${url.port ? `:${url.port}` : ""}${database ? `/${database}` : ""}`;
    } catch {
        return undefined;
    }
}

/**
 * The script a change process applies: a header saying what it is and how to
 * run it, then every recorded statement in order.
 *
 * Deliberately free of anything that changes between two runs of the same
 * release against the same state — no timestamp — so that two scripts can be
 * diffed, and a reviewer comparing this release's script with the last one
 * sees only what the release changed.
 */
export function renderSchemaChangeScript(
    statements: readonly string[],
    context: { runtimeVersion?: string; database?: string }
): string {
    const header = [
        "-- Schema changes made by a Rebase provisioning run (REBASE_PROVISION_ONLY=true).",
        "--",
        ...(context.runtimeVersion ? [`-- Runtime: @rebasepro/server ${context.runtimeVersion}`] : []),
        ...(context.database ? [`-- Recorded against: ${context.database}`] : []),
        `-- Statements: ${statements.length}`,
        "--",
        "-- Every statement below ran, in this order, and succeeded. Recorded against an",
        "-- empty database, this is the whole schema the release needs; against a copy of",
        "-- production, it is the upgrade. Apply it as a role that may create in the database:",
        "--",
        "--   psql \"$DATABASE_URL\" -v ON_ERROR_STOP=1 -f <this file>",
        ...(statements.some(statement => /\bCONCURRENTLY\b/i.test(statement))
            ? [
                "--",
                "-- Not inside one transaction (no `psql -1`, no BEGIN around it): it builds an",
                "-- index CONCURRENTLY, which PostgreSQL refuses to run in a transaction block."
            ]
            : []),
        "--",
        "-- Rows the run wrote (the first admin account, version stamps, backfills) are not",
        "-- schema and are not included."
    ];
    if (statements.length === 0) {
        return [...header, "", "-- Nothing to change: the database already had everything this release needs.", ""].join("\n");
    }
    return [...header, "", statements.map(terminated).join("\n\n"), ""].join("\n");
}
