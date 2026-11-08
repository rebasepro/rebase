/**
 * A request's transaction, opened in the same round trip as its first query.
 *
 * Every request runs in a transaction that starts with two statements of its
 * own: `BEGIN`, and the `set_config` that hands Postgres the caller's identity
 * and drops to the restricted role (`authContextStatement`). Sent one after
 * the other, each waits for the last, and a lone read paid four round trips —
 * `BEGIN`, the context, the read, `COMMIT` — where the same read in SQL pays
 * one. Against a database a few milliseconds away that is most of the request.
 *
 * Postgres accepts several statements in one batch: the extended protocol's
 * Parse/Bind/Execute for each, then one Sync. The server runs them in order
 * and answers them together, so this sends nothing when the transaction is
 * opened and puts its opening statements in front of the first query instead.
 * Should one of them fail, the server skips the rest up to the Sync: a refused
 * role switch fails the batch before the query runs, with the same error a
 * statement of its own would have raised.
 *
 * A read-only transaction at READ COMMITTED goes one step further. Each of its
 * statements reads its own snapshot, so running each statement in a batch of
 * its own with the context in front — a transaction that ends at the Sync —
 * is the same transaction as far as anything inside it can tell, minus the
 * `BEGIN` and `COMMIT`. A lone read is then one round trip, as in SQL. A
 * statement that only means something inside a transaction block (a
 * savepoint, `SET LOCAL`, a cursor, a transaction-scoped lock) opens a real
 * one, from that statement on.
 *
 * Statement values are serialized by pg's own `prepareValue`, so a value means
 * the same here as in any other query; rows are parsed with the query's own
 * type parsers, as pg's `Query` parses them.
 */
// The declaration of `pg/lib/utils.js` is a script, not a module, so no
// import can bring it along: referenced, it reaches every program that
// compiles this file, the ones that do not list `src/types` included.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./types/pg-lib-utils.d.ts" />
import pg, { type Connection, type FieldDef, type Pool, type PoolClient, type QueryResult, type QueryResultRow, type Submittable } from "pg";
import { prepareValue } from "pg/lib/utils.js";
import { NodePgDatabase, NodePgSession, NodePgTransaction } from "drizzle-orm/node-postgres";
import { PgDialect, type PgTransactionConfig } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations, RelationalSchemaConfig, TablesRelationalConfig } from "drizzle-orm";

/** A statement and its values, as the extended protocol sends it. */
export interface PipelineStatement {
    text: string;
    values?: readonly unknown[];
}

/** What `NodePgSession` hands `client.query` for a statement: pg's query config. */
interface ClientQueryConfig {
    text: string;
    values?: unknown[];
    name?: string;
    rowMode?: string;
    rows?: number;
    types?: { getTypeParser: typeof pg.types.getTypeParser };
}

type RowParser = (value: string) => unknown;
type ResultCallback = (error: Error | null, result?: QueryResult) => void;

const COMMAND_TAG = /^([A-Za-z]+)(?: (\d+))?(?: (\d+))?/;

/**
 * Statements sent as one batch: Parse/Bind/Describe/Execute for each, one
 * Sync, one round trip. The last statement's result is the batch's; the
 * others are run for their effect and their rows are dropped unparsed.
 *
 * A pg {@link Submittable}, the interface pg-cursor is built on: pg writes
 * nothing for it but what `submit` writes, and hands it each message the
 * server sends back until ReadyForQuery.
 */
export class PipelinedQuery implements Submittable {
    /** How many statements this batch sends. */
    readonly statementCount: number;
    /** Set by `client.query`, which wraps it for its read timeout. */
    callback?: ResultCallback;

    /** The statements, in the order they are sent, with their serialized values. */
    readonly statements: { text: string; values: (string | Buffer | null)[] }[];
    private readonly rowMode: string | undefined;
    private readonly types: { getTypeParser: typeof pg.types.getTypeParser };
    /** Statements ahead of the last whose completion has not arrived yet. */
    private ahead: number;
    private fields: FieldDef[] = [];
    private parsers: RowParser[] = [];
    private readonly rows: unknown[] = [];
    private command = "";
    private rowCount: number | null = null;
    private oid = 0;
    private rowError: Error | undefined;
    private settled = false;

    constructor(lead: readonly PipelineStatement[], last: ClientQueryConfig, callback: ResultCallback) {
        // Serialized up front, so a value pg cannot send fails the call
        // before anything reaches the connection.
        this.statements = [...lead, last].map(statement => ({
            text: statement.text,
            values: (statement.values ?? []).map(value => prepareValue(value))
        }));
        this.statementCount = this.statements.length;
        this.ahead = lead.length;
        this.rowMode = last.rowMode;
        this.types = last.types ?? pg.types;
        this.callback = callback;
    }

    submit(connection: Connection): void {
        connection.stream.cork();
        try {
            for (const statement of this.statements) {
                connection.parse({ text: statement.text, name: "", types: [] }, true);
                connection.bind({ portal: "", statement: "", values: statement.values }, true);
                connection.describe({ type: "P", name: "" }, true);
                connection.execute({ portal: "" }, true);
            }
            connection.sync();
        } finally {
            connection.stream.uncork();
        }
    }

    handleRowDescription(message: { fields: FieldDef[] }): void {
        if (this.ahead > 0) return;
        this.fields = message.fields;
        this.parsers = message.fields.map(field => this.types.getTypeParser(field.dataTypeID, "text") as RowParser);
    }

    handleDataRow(message: { fields: (string | null)[] }): void {
        if (this.ahead > 0 || this.rowError) return;
        const values = message.fields;
        try {
            if (this.rowMode === "array") {
                const row = new Array<unknown>(values.length);
                for (let i = 0; i < values.length; i++) {
                    const raw = values[i];
                    row[i] = raw === null ? null : this.parsers[i](raw);
                }
                this.rows.push(row);
            } else {
                const row: Record<string, unknown> = {};
                for (let i = 0; i < values.length; i++) {
                    const raw = values[i];
                    row[this.fields[i].name] = raw === null ? null : this.parsers[i](raw);
                }
                this.rows.push(row);
            }
        } catch (error) {
            // Reported at ReadyForQuery, as pg's own Query does.
            this.rowError = error instanceof Error ? error : new Error(String(error));
        }
    }

    handleCommandComplete(message: { text: string }): void {
        if (this.ahead > 0) {
            this.ahead -= 1;
            return;
        }
        const match = COMMAND_TAG.exec(message.text);
        if (!match) return;
        this.command = match[1];
        if (match[3]) {
            this.oid = Number.parseInt(match[2], 10);
            this.rowCount = Number.parseInt(match[3], 10);
        } else if (match[2]) {
            this.rowCount = Number.parseInt(match[2], 10);
        }
    }

    /** An empty statement completes with EmptyQueryResponse rather than CommandComplete. */
    handleEmptyQuery(): void {
        if (this.ahead > 0) this.ahead -= 1;
    }

    handlePortalSuspended(): void {
        // Every Execute asks for all rows, so no portal is ever suspended.
    }

    handleError(error: Error): void {
        if (this.settled) return;
        this.settled = true;
        this.callback?.(error);
    }

    handleReadyForQuery(): void {
        if (this.settled) return;
        this.settled = true;
        if (this.rowError) {
            this.callback?.(this.rowError);
            return;
        }
        const result: QueryResult<QueryResultRow> = {
            command: this.command,
            rowCount: this.rowCount,
            oid: this.oid,
            fields: this.fields,
            rows: this.rows as QueryResultRow[]
        };
        this.callback?.(null, result);
    }
}

/** Send `lead` and then `last` in one round trip; the result is `last`'s. */
export function runPipelined(client: PoolClient, lead: readonly PipelineStatement[], last: ClientQueryConfig): Promise<QueryResult> {
    return new Promise((resolve, reject) => {
        client.query(new PipelinedQuery(lead, last, (error, result) => {
            if (error) reject(error);
            else if (result) resolve(result);
        }));
    });
}

/**
 * A statement that means something only inside a transaction block, so a
 * read cannot run it in a batch of its own: savepoints, transaction-local
 * settings, cursors and transaction-scoped locks.
 */
const NEEDS_TRANSACTION_BLOCK = /^\s*(?:savepoint|release|rollback|set\s+local|set\s+transaction|declare|lock|prepare\s+transaction)\b|\bset_config\s*\(|\bpg_advisory_xact_lock|\bpg_try_advisory_xact_lock/i;

/**
 * A statement pg runs with a protocol of its own: COPY streams, a named
 * statement pg keeps track of, a portal read page by page. Sent as pg sends
 * it, after the transaction's opening has gone ahead in a batch of its own.
 */
function cannotPipeline(config: ClientQueryConfig): boolean {
    return Boolean(config.name) || Boolean(config.rows) || /^\s*copy\b/i.test(config.text);
}

function toQueryConfig(statement: PipelineStatement): ClientQueryConfig {
    return { text: statement.text, values: statement.values ? [...statement.values] : undefined };
}

function beginStatement(config: PgTransactionConfig | undefined): string {
    const parts = ["begin"];
    if (config?.isolationLevel) parts.push(`isolation level ${config.isolationLevel}`);
    if (config?.accessMode) parts.push(config.accessMode);
    if (typeof config?.deferrable === "boolean") parts.push(config.deferrable ? "deferrable" : "not deferrable");
    return parts.join(" ");
}

/**
 * Whether a transaction with these settings can run each statement in a batch
 * of its own. Read-only, at READ COMMITTED: every statement takes its own
 * snapshot there anyway, and none of them can write.
 */
export function runsStatementByStatement(config: PgTransactionConfig | undefined): boolean {
    return config?.accessMode === "read only"
        && (config.isolationLevel === undefined || config.isolationLevel === "read committed")
        && config.deferrable !== true;
}

/**
 * A savepoint being set or released: a statement with no result to wait for,
 * which can go out with whatever is sent next.
 */
const DEFERRABLE = /^\s*(?:savepoint|release(?:\s+savepoint)?)\s+[A-Za-z_][A-Za-z0-9_]*\s*;?\s*$/i;

const ROLLBACK_TO = /^\s*rollback\s+to\s+(?:savepoint\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*;?\s*$/i;

function settledWithoutSending(text: string): Promise<QueryResult> {
    const command = text.trim().split(/\s+/)[0].toUpperCase();
    return Promise.resolve({ command, rowCount: null, oid: 0, fields: [], rows: [] });
}

/**
 * The client side of one transaction: sends its opening with the first query,
 * holds savepoints back until a statement goes out after them, and sends
 * `COMMIT` or `ROLLBACK` only when something was sent.
 */
class TransactionOpening {
    /** `fresh`: nothing sent. `implicit`: each statement ran in a batch of its own. `open`: in a transaction block. */
    private state: "fresh" | "implicit" | "open" = "fresh";
    /** In a block: statements accepted and not yet sent, which go out ahead of the next one. */
    private pending: PipelineStatement[] = [];
    /** In a block: whether its `BEGIN` has reached the server. */
    private begun = false;

    constructor(
        private readonly client: PoolClient,
        private readonly begin: string,
        private readonly opening: readonly PipelineStatement[],
        private readonly statementByStatement: boolean
    ) {}

    /** The `query` the transaction's drizzle session calls. Decides synchronously, so concurrent calls queue in order. */
    query(config: ClientQueryConfig | string, values?: unknown[]): Promise<QueryResult> {
        const statement: ClientQueryConfig = typeof config === "string"
            ? { text: config, values }
            : values !== undefined ? { ...config, values } : config;
        const pipelinable = !cannotPipeline(statement);

        if (this.state !== "open") {
            if (this.statementByStatement && pipelinable && !NEEDS_TRANSACTION_BLOCK.test(statement.text)) {
                this.state = "implicit";
                return runPipelined(this.client, [READ_ONLY_STATEMENT, ...this.opening], statement);
            }
            this.state = "open";
            this.pending = [{ text: this.begin }, ...this.opening];
        }

        // Back to a savepoint that has not gone out yet: nothing ran after it,
        // so there is nothing to undo, and neither needs sending.
        const rollbackTo = ROLLBACK_TO.exec(statement.text);
        if (rollbackTo) {
            const at = this.pending.findLastIndex(pending => pending.text.trim().toLowerCase() === `savepoint ${rollbackTo[1].toLowerCase()}`);
            if (at >= 0) {
                this.pending = this.pending.slice(0, at);
                return settledWithoutSending(statement.text);
            }
        }
        if (DEFERRABLE.test(statement.text) && !statement.values?.length) {
            this.pending.push({ text: statement.text });
            return settledWithoutSending(statement.text);
        }
        return this.send(statement, pipelinable);
    }

    /** `statement`, with everything pending in front of it. */
    private send(statement: ClientQueryConfig, pipelinable = true): Promise<QueryResult> {
        const lead = this.pending;
        this.pending = [];
        if (lead.length > 0) this.begun = true;
        if (lead.length === 0) return this.client.query(statement);
        if (pipelinable) return runPipelined(this.client, lead, statement);
        return runPipelined(this.client, lead.slice(0, -1), toQueryConfig(lead[lead.length - 1]))
            .then(() => this.client.query(statement));
    }

    async commit(): Promise<void> {
        // Nothing reached the server: there is nothing to commit.
        if (this.state === "open" && this.begun) await this.send({ text: "commit" });
        this.pending = [];
    }

    async rollback(): Promise<void> {
        // What is still pending never reached the server, and goes with the transaction.
        this.pending = [];
        if (this.state === "open" && this.begun) await this.client.query("rollback");
    }
}

/**
 * What `SET TRANSACTION READ ONLY` sets, as a statement that can run in a batch
 * outside a transaction block — where `SET TRANSACTION` warns and does nothing.
 */
const READ_ONLY_STATEMENT: PipelineStatement = { text: "SELECT set_config('transaction_read_only', 'on', true)" };

/** The relational schema a drizzle handle was built with, for a session over another client. */
function schemaConfigOf(db: NodePgDatabase<Record<string, unknown>>): RelationalSchemaConfig<TablesRelationalConfig> | undefined {
    const { schema, fullSchema, tableNamesMap } = db._;
    return schema && fullSchema ? { schema, fullSchema, tableNamesMap } : undefined;
}

const dialect = new PgDialect();

/**
 * The drizzle handle and pg pool to run a pipelined transaction on, or
 * `undefined` for a handle that is not a drizzle database over a pg pool of
 * this process's pg (PGlite, a transaction, a caller's own copy of either
 * library), which opens its transactions statement by statement.
 */
export function pipelineTarget(db: unknown): { db: NodePgDatabase<Record<string, unknown>>; pool: Pool } | undefined {
    if (!(db instanceof NodePgDatabase) || !("$client" in db)) return undefined;
    const client = db.$client;
    return client instanceof pg.Pool ? { db, pool: client } : undefined;
}

/**
 * Run `work` in a transaction on a client of `pool`, its opening sent with the
 * first query.
 *
 * `opening` runs at the start of the transaction, after the `BEGIN` that
 * `config` describes — and, for a read-only transaction at READ COMMITTED,
 * ahead of every statement, each in a transaction of its own (see the module
 * comment). `work` gets a drizzle transaction like the one
 * `db.transaction()` hands out: savepoints nest inside it, and it commits
 * when `work` resolves and rolls back when it throws.
 */
export async function runPipelinedTransaction<T, TSchema extends Record<string, unknown>>(
    db: NodePgDatabase<TSchema>,
    pool: Pool,
    opening: readonly PipelineStatement[],
    config: PgTransactionConfig | undefined,
    work: (tx: NodePgTransaction<TSchema, ExtractTablesWithRelations<TSchema>>) => Promise<T>
): Promise<T> {
    const client = await pool.connect();
    const transaction = new TransactionOpening(client, beginStatement(config), opening, runsStatementByStatement(config));
    // The client drizzle's session talks to: this transaction's `query`, and
    // the pooled client for everything else.
    const sessionClient = new Proxy(client, {
        get(target, property) {
            if (property === "query") return transaction.query.bind(transaction);
            const value: unknown = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
        }
    });
    const schema = schemaConfigOf(db as NodePgDatabase<Record<string, unknown>>) as RelationalSchemaConfig<ExtractTablesWithRelations<TSchema>> | undefined;
    const session = new NodePgSession(sessionClient, dialect, schema);
    const tx = new NodePgTransaction<TSchema, ExtractTablesWithRelations<TSchema>>(dialect, session, schema);
    try {
        let result: T;
        try {
            result = await work(tx);
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
        await transaction.commit();
        return result;
    } finally {
        client.release();
    }
}
