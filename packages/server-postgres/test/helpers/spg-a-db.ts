/**
 * Typed stand-ins for the database handles the unit tests drive.
 *
 * `spiedDrizzle()` is a real `NodePgDatabase` over a pool that cannot connect,
 * with `execute` replaced by a jest spy — so the code under test gets the
 * actual type it declares, and a test still decides what every statement
 * returns. `queryResult()` builds the full `pg` result a statement resolves to,
 * not the `{ rows }` fragment the code happens to read today.
 */
import { Pool, type QueryResult, type QueryResultRow } from "pg";
import { is, sql, type ExtractTablesWithRelations, type SQL, type TableRelationalConfig, type TablesRelationalConfig } from "drizzle-orm";
import { NodePgDatabase, NodePgSession, NodePgTransaction } from "drizzle-orm/node-postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import { RelationalQueryBuilder } from "drizzle-orm/pg-core/query-builders/query";
import { PgRaw } from "drizzle-orm/pg-core/query-builders/raw";

/** A complete `pg` query result around `rows`. */
export function queryResult<R extends QueryResultRow = Record<string, unknown>>(
    rows: R[] = [],
    command = "SELECT"
): QueryResult<R> {
    return {
        command,
        rowCount: rows.length,
        oid: 0,
        fields: [],
        rows
    };
}

export interface SpiedDrizzle {
    db: NodePgDatabase;
    execute: jest.SpiedFunction<NodePgDatabase["execute"]>;
}

/**
 * A pool that cannot reach a server: port 1 refuses at once. A statement no
 * spy answers fails loudly instead of finding whatever Postgres the machine
 * running the tests happens to have.
 */
function unreachablePool(): Pool {
    return new Pool({ host: "127.0.0.1", port: 1, connectionTimeoutMillis: 1000 });
}

/**
 * A real drizzle database whose `execute` resolves to an empty result unless a
 * test says otherwise. Built without `drizzle()`'s `$client`, so the driver
 * sees a plain database and takes `db.transaction`, not the pipelined path
 * that checks a client out of the pool itself.
 */
export function spiedDrizzle(): SpiedDrizzle {
    const dialect = new PgDialect();
    const db = new NodePgDatabase(dialect, new NodePgSession(unreachablePool(), dialect, undefined), undefined);
    const execute = jest.spyOn(db, "execute").mockResolvedValue(queryResult());
    return { db, execute };
}

type NoSchema = Record<string, never>;

export interface TransactionalDrizzle extends SpiedDrizzle {
    /** The transaction every `db.transaction(cb)` hands its callback. */
    tx: NodePgTransaction<NoSchema, ExtractTablesWithRelations<NoSchema>>;
    /** `tx.execute`, resolving to an empty result unless a test says otherwise. */
    txExecute: jest.SpiedFunction<NodePgTransaction<NoSchema, ExtractTablesWithRelations<NoSchema>>["execute"]>;
    /** How the last transaction ended: a rejected callback is the rollback, as in Postgres. */
    state: { committed: boolean; rolledBack: boolean };
}

/**
 * A real drizzle database whose `transaction(cb)` runs `cb` with a real
 * transaction object and records whether it committed — the callback's
 * rejection is the rollback. Both `execute`s are spied; nothing else reaches a server.
 */
export function transactionalDrizzle(): TransactionalDrizzle {
    const { db, execute } = spiedDrizzle();
    const dialect = new PgDialect();
    const tx = new NodePgTransaction<NoSchema, ExtractTablesWithRelations<NoSchema>>(
        dialect,
        new NodePgSession(unreachablePool(), dialect, undefined),
        undefined
    );
    const txExecute = jest.spyOn(tx, "execute").mockResolvedValue(queryResult());
    const state = { committed: false, rolledBack: false };
    jest.spyOn(db, "transaction").mockImplementation(async (callback) => {
        try {
            const out = await callback(tx);
            state.committed = true;
            return out;
        } catch (error) {
            state.rolledBack = true;
            throw error;
        }
    });
    return { db, execute, tx, txExecute, state };
}

/**
 * `db.query[table]` for a schema built at runtime, whose table keys are not in
 * the type — narrowed to drizzle's builder rather than asserted.
 */
export function relationalQuery(
    db: { query: object },
    table: string
): RelationalQueryBuilder<TablesRelationalConfig, TableRelationalConfig> {
    const builder: unknown = Reflect.get(db.query, table);
    if (!is(builder, RelationalQueryBuilder)) throw new Error(`drizzle built no relational query for "${table}"`);
    return builder;
}

/**
 * Answer every statement a spied `execute` is handed with `handler` — a
 * stand-in for the database, given the statement as the SQL object drizzle
 * built. What the handler resolves to is the statement's result. The handler
 * runs when `execute` is called, as a database client would send it then.
 */
export function answerStatements(
    execute: SpiedDrizzle["execute"],
    handler: (query: SQL) => QueryResult<Record<string, unknown>> | Promise<QueryResult<Record<string, unknown>>>
): void {
    const dialect = new PgDialect();
    execute.mockImplementation((query) => {
        const statement = typeof query === "string" ? sql.raw(query) : query.getSQL();
        const result = Promise.resolve(handler(statement));
        return new PgRaw(() => result, statement, dialect.sqlToQuery(statement), (outcome) => outcome);
    });
}
