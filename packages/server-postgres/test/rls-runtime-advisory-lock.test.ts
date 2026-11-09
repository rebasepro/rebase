import { describe, it, expect, jest } from "@jest/globals";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

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
    let nextConnection = 0;
    /** Session advisory locks each connection still holds. */
    const held = new Map<number, number>();
    const statements: Array<{ connection: number; text: string; inTransaction: boolean }> = [];
    const answer = { rows: [], rowCount: 0, command: "", oid: 0, fields: [] };

    const textOf = (config: unknown): string =>
        typeof config === "string" ? config
            : typeof config === "object" && config !== null && "text" in config && typeof config.text === "string" ? config.text : "";

    const run = (connection: number, inTransaction: boolean, text: string) => {
        statements.push({ connection, text, inTransaction });
        if (text.includes(`pg_advisory_lock(${KEY})`)) {
            held.set(connection, (held.get(connection) ?? 0) + 1);
        } else if (text.includes(`pg_advisory_unlock(${KEY})`)) {
            const count = held.get(connection) ?? 0;
            // Postgres refuses to release a lock this session does not hold.
            if (count > 0) held.set(connection, count - 1);
        }
        return answer;
    };

    // A real pool whose connections are made up: a statement on the pool is a
    // fresh connection, and a transaction keeps the client it checked out.
    const pool = new pg.Pool();
    jest.spyOn(pool, "query").mockImplementation(async (config: unknown) => run(nextConnection++, false, textOf(config)));
    jest.spyOn(pool, "connect").mockImplementation(async () => {
        const connection = nextConnection++;
        const client = Object.assign(new pg.Client(), { release: () => undefined });
        jest.spyOn(client, "query").mockImplementation(async (config: unknown) => {
            const text = textOf(config);
            // The transaction's own bracketing is drizzle's, not the code under test's.
            if (/^\s*(begin|commit|rollback)\b/i.test(text)) return answer;
            return run(connection, true, text);
        });
        return client;
    });
    const db = drizzle({ client: pool });

    const leaked = () => [...held.entries()].filter(([, count]) => count > 0).map(([connection]) => connection);
    return { db, statements, leaked };
}

describe("ensureRlsRuntime", () => {
    it("leaves no advisory lock behind on any pooled connection", async () => {
        const pool = pooledDb();
        const bootstrapper = createPostgresBootstrapper({ connection: pool.db });

        await bootstrapper.ensureRlsRuntime!();

        expect(pool.leaked()).toEqual([]);
    });

    it("takes the lock and runs every statement in one transaction, on one connection", async () => {
        const pool = pooledDb();
        const bootstrapper = createPostgresBootstrapper({ connection: pool.db });

        await bootstrapper.ensureRlsRuntime!();

        const lock = pool.statements.find(s => s.text.includes("pg_advisory"));
        expect(lock?.text).toContain(`pg_advisory_xact_lock(${KEY})`);
        // Before it, one read of the catalogue — the helpers are only replaced
        // when they differ (this pool answers "not there").
        const [read, ...rest] = pool.statements;
        expect(read.inTransaction).toBe(false);
        expect(read.text).toMatch(/^\s*SELECT[\s\S]*FROM pg_proc/);
        expect(rest).toHaveLength(RLS_BOOTSTRAP_STATEMENTS.length + 1);
        expect(rest.every(s => s.inTransaction && s.connection === lock!.connection)).toBe(true);
    });
});
