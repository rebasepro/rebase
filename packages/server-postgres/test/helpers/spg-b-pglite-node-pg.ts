/**
 * A drizzle node-postgres database whose pg client talks to an in-process PGlite.
 *
 * The driver, the realtime service and the history service are typed against
 * `NodePgDatabase` because node-postgres is what they run on — including the
 * managed development database, which is PGlite behind a socket server and a
 * pg pool. A `drizzle-orm/pglite` handle is a different type, so tests used to
 * build one and cast it. This builds the real thing instead: drizzle's
 * node-postgres session over a `pg.Client` whose `query` is answered by PGlite,
 * with node-postgres's result semantics — values parsed by pg's type parsers
 * (or the ones drizzle hands each query), `rowCount`, array rows on request, and
 * several statements in one parameterless query answered with one result each.
 *
 * Like PGlite's own drizzle driver, a transaction has the database to itself:
 * statements from outside it wait until it settles.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { jest } from "@jest/globals";
import pg from "pg";
import type { PGlite, Results } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/node-postgres";
import type { DrizzleConfig } from "drizzle-orm";

interface TypeParserSource {
    getTypeParser(oid: number, format: "text"): (value: string) => unknown;
}

interface ClientQuery {
    text: string;
    values: unknown[];
    arrayRows: boolean;
    types?: TypeParserSource;
}

function isTypeParserSource(value: unknown): value is TypeParserSource {
    return value !== null && typeof value === "object" && "getTypeParser" in value && typeof value.getTypeParser === "function";
}

/** What one `client.query(...)` call asked for, in either of the forms drizzle and the driver use. */
function clientQueryOf(args: readonly unknown[]): ClientQuery {
    const [first, second] = args;
    const valuesOf = (v: unknown): unknown[] => (Array.isArray(v) ? [...v] : []);
    if (typeof first === "string") return { text: first, values: valuesOf(second), arrayRows: false };
    if (first !== null && typeof first === "object" && "text" in first && typeof first.text === "string") {
        const configValues = "values" in first ? first.values : undefined;
        const rowMode = "rowMode" in first ? first.rowMode : undefined;
        const types = "types" in first ? first.types : undefined;
        return {
            text: first.text,
            values: valuesOf(second ?? configValues),
            arrayRows: rowMode === "array",
            types: isTypeParserSource(types) ? types : undefined
        };
    }
    throw new Error(`pglite client: unsupported query arguments ${JSON.stringify(args)}`);
}

/** A promise chain: each holder runs once the one before it has settled. */
function createMutex() {
    let tail: Promise<unknown> = Promise.resolve();
    return <T>(work: () => Promise<T>): Promise<T> => {
        const run = tail.then(work, work);
        tail = run.catch(() => undefined);
        return run;
    };
}

export function pgliteNodePg<TSchema extends Record<string, unknown> = Record<string, never>>(
    pglite: PGlite,
    config: Omit<DrizzleConfig<TSchema>, "client"> = {}
) {
    // PGlite's own parsing switched off, so every value arrives as Postgres
    // text and pg's parsers decide what it becomes, as on a real connection.
    const asText = () => Object.fromEntries(Object.keys(pglite.parsers).map(oid => [Number(oid), (value: string) => value]));

    const toPgResult = (result: Results, query: ClientQuery) => {
        const parserFor = (oid: number) => (query.types ?? pg.types).getTypeParser(oid, "text");
        const parsers = result.fields.map(field => parserFor(field.dataTypeID));
        const parse = (value: unknown, i: number) => (typeof value === "string" ? parsers[i](value) : value);
        const rows = result.rows.map(row => {
            // Asked of PGlite in array mode, so every row is its values in field order.
            if (!Array.isArray(row)) throw new Error("pglite client: expected an array row");
            const values = row.map(parse);
            return query.arrayRows ? values : Object.fromEntries(result.fields.map((field, i) => [field.name, values[i]]));
        });
        const command = /^\s*(\w+)/.exec(query.text)?.[1]?.toUpperCase() ?? "";
        return {
            command,
            rowCount: result.affectedRows ? result.affectedRows : rows.length,
            oid: 0,
            fields: result.fields.map(field => ({ name: field.name, dataTypeID: field.dataTypeID })),
            rows
        };
    };

    const run = async (query: ClientQuery) => {
        const options = { rowMode: "array" as const, parsers: asText() };
        if (query.values.length === 0) {
            // pg sends a parameterless query with the simple protocol, which
            // takes several statements and answers each.
            const results = await pglite.exec(query.text, options);
            const mapped = results.map(result => toPgResult(result, query));
            return mapped.length === 1 ? mapped[0] : mapped;
        }
        return toPgResult(await pglite.query(query.text, query.values, options), query);
    };

    const inTransaction = new AsyncLocalStorage<true>();
    const exclusive = createMutex();

    const client = new pg.Client({ connectionString: "postgres://pglite@127.0.0.1:1/pglite" });
    jest.spyOn(client, "query").mockImplementation((...args: unknown[]) => {
        const query = clientQueryOf(args);
        return inTransaction.getStore() ? run(query) : exclusive(() => run(query));
    });

    const db = drizzle({ ...config, client });
    const transaction = db.transaction.bind(db);
    jest.spyOn(db, "transaction").mockImplementation((work, transactionConfig) =>
        exclusive(() => inTransaction.run(true, () => transaction(work, transactionConfig))));
    return db;
}
