import { describe, it, expect } from "@jest/globals";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import { createPostgresBootstrapper } from "../src/PostgresBootstrapper";
import { RLS_BOOTSTRAP_STATEMENTS } from "../src/schema/rls-bootstrap-sql";

/**
 * Provisioning the RLS helpers takes its lock and gives it back on the one
 * connection that holds it.
 *
 * It used to take a *session* advisory lock with one statement and release it
 * with another, each through the pool. A pool hands each statement whichever
 * connection is free — behind a transaction-mode pooler, a different server
 * connection every time — so the unlock could land on a connection that did not
 * hold the lock. It answered `false` ("you don't own a lock"), and the lock
 * stayed on a pooled connection that looked idle. The next replica's boot then
 * waited at the same key (auth takes it too) until `statement_timeout` and
 * failed, for as long as that connection lived.
 *
 * The pool here is the pooler's worst case, made deterministic: every statement
 * outside a transaction gets a fresh server connection, and a transaction keeps
 * the one it began on. Session locks live on their connection until it unlocks
 * them; transaction locks go at commit.
 */
const KEY = "hashtext('rebase_auth_functions_init')";

function pooledDb() {
    const dialect = new PgDialect();
    let nextConnection = 0;
    /** Session advisory locks each connection still holds. */
    const held = new Map<number, number>();
    const statements: Array<{ connection: number; text: string; inTransaction: boolean }> = [];

    const run = (connection: number, inTransaction: boolean, query: SQL) => {
        const text = dialect.sqlToQuery(query).sql;
        statements.push({ connection, text, inTransaction });
        if (text.includes(`pg_advisory_lock(${KEY})`)) {
            held.set(connection, (held.get(connection) ?? 0) + 1);
        } else if (text.includes(`pg_advisory_unlock(${KEY})`)) {
            const count = held.get(connection) ?? 0;
            // Postgres refuses to release a lock this session does not hold.
            if (count > 0) held.set(connection, count - 1);
        }
        return Promise.resolve({ rows: [] });
    };

    const db = {
        execute: (query: SQL) => run(nextConnection++, false, query),
        transaction: async <T>(fn: (tx: { execute: (query: SQL) => Promise<unknown> }) => Promise<T>) => {
            const connection = nextConnection++;
            return fn({ execute: (query: SQL) => run(connection, true, query) });
        }
    };

    const leaked = () => [...held.entries()].filter(([, count]) => count > 0).map(([connection]) => connection);
    return { db, statements, leaked };
}

describe("ensureRlsRuntime", () => {
    it("leaves no advisory lock behind on any pooled connection", async () => {
        const pool = pooledDb();
        const bootstrapper = createPostgresBootstrapper({ connection: pool.db } as never);

        await bootstrapper.ensureRlsRuntime!();

        expect(pool.leaked()).toEqual([]);
    });

    it("takes the lock and runs every statement in one transaction, on one connection", async () => {
        const pool = pooledDb();
        const bootstrapper = createPostgresBootstrapper({ connection: pool.db } as never);

        await bootstrapper.ensureRlsRuntime!();

        const lock = pool.statements.find(s => s.text.includes("pg_advisory"));
        expect(lock?.text).toContain(`pg_advisory_xact_lock(${KEY})`);
        expect(pool.statements).toHaveLength(RLS_BOOTSTRAP_STATEMENTS.length + 1);
        expect(pool.statements.every(s => s.inTransaction && s.connection === lock!.connection)).toBe(true);
    });
});
