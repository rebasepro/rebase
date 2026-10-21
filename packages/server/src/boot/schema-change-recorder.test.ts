import { describe, it, expect } from "@jest/globals";
import { describeDatabase, recordSchemaChanges, renderSchemaChangeScript, splitStatements } from "./schema-change-recorder";
import type { PoolConnect } from "../metrics/pool-wait";

/**
 * The two shapes `pg` gives a connection to callers — a pool's `connect` with a
 * callback (what `pool.query` uses) and without one (what a transaction uses) —
 * over a client whose `query` speaks both of its own forms. Statements whose
 * text contains "fail" are rejected, as the database would.
 */
function fakePool() {
    const ran: string[] = [];
    const client = {
        query(...args: unknown[]): unknown {
            const first = args[0];
            const text = typeof first === "string" ? first : (first as { text: string }).text;
            const failed = text.includes("fail") ? new Error(`rejected: ${text}`) : undefined;
            if (!failed) ran.push(text);
            const last = args[args.length - 1];
            if (typeof last === "function") {
                (last as (err: unknown, result: unknown) => void)(failed, { rows: [] });
                return undefined;
            }
            return failed ? Promise.reject(failed) : Promise.resolve({ rows: [] });
        }
    };
    const connect: PoolConnect = (callback) => {
        if (typeof callback === "function") {
            callback(undefined, client, () => undefined);
            return undefined;
        }
        return Promise.resolve(client);
    };
    const pool = {
        connect,
        /** `pg.Pool#query`: checks out through `this.connect`, as the real one does. */
        query(text: string): Promise<unknown> {
            return new Promise((resolve, reject) => {
                pool.connect((err, checkedOut) => {
                    if (err) return reject(err);
                    (checkedOut as typeof client).query(text, (queryErr: unknown, result: unknown) =>
                        queryErr ? reject(queryErr) : resolve(result));
                });
            });
        }
    };
    return { pool, ran };
}

describe("recordSchemaChanges", () => {
    it("records every schema change that completed, through both checkout shapes, and nothing else", async () => {
        const { pool } = fakePool();
        const recorder = recordSchemaChanges([pool]);

        await pool.query("CREATE SCHEMA IF NOT EXISTS rebase");
        await pool.query("SELECT 1 FROM rebase.api_keys WHERE false");
        const client = await pool.connect() as { query: (config: { text: string }) => Promise<unknown> };
        await client.query({ text: "ALTER TABLE rebase.api_keys ADD COLUMN IF NOT EXISTS kind TEXT" });
        await client.query({ text: "INSERT INTO rebase.schema_meta (key, value) VALUES ('v', '1')" });
        await expect(pool.query("CREATE TABLE fail (id int)")).rejects.toThrow(/rejected/);

        expect(recorder.statements()).toEqual([
            "CREATE SCHEMA IF NOT EXISTS rebase",
            "ALTER TABLE rebase.api_keys ADD COLUMN IF NOT EXISTS kind TEXT"
        ]);
    });

    it("leaves the pool working after it stops, and records nothing more", async () => {
        const { pool, ran } = fakePool();
        const recorder = recordSchemaChanges([pool]);
        await pool.query("CREATE TABLE a (id int)");
        recorder.stop();
        await pool.query("CREATE TABLE b (id int)");

        expect(recorder.statements()).toEqual(["CREATE TABLE a (id int)"]);
        expect(ran).toEqual(["CREATE TABLE a (id int)", "CREATE TABLE b (id int)"]);
    });

    it("reads into a batch — boot sends a table and its indexes as one string behind a SET LOCAL", async () => {
        const { pool } = fakePool();
        const recorder = recordSchemaChanges([pool]);

        await pool.query("SET LOCAL lock_timeout = '1000ms';\nCREATE TABLE \"public\".\"notes\" (id uuid);\nCREATE INDEX i ON notes (id);");

        expect(recorder.statements()).toEqual(["CREATE TABLE \"public\".\"notes\" (id uuid)", "CREATE INDEX i ON notes (id)"]);
    });

    it("keeps a transaction's changes only once it commits, and none of one that rolled back", async () => {
        const { pool } = fakePool();
        const recorder = recordSchemaChanges([pool]);
        const client = await pool.connect() as { query: (text: string) => Promise<unknown> };

        await client.query("BEGIN");
        await client.query("CREATE POLICY probe ON t USING (true)");
        expect(recorder.statements()).toEqual([]);
        await client.query("ROLLBACK");

        await client.query("begin");
        await client.query("CREATE TABLE kept (id int)");
        await client.query("SAVEPOINT s1");
        await client.query("CREATE TABLE undone (id int)");
        await client.query("ROLLBACK TO SAVEPOINT s1");
        await client.query("COMMIT");

        expect(recorder.statements()).toEqual(["CREATE TABLE kept (id int)"]);
    });

    it("wraps a connection once, however many times it is checked out", async () => {
        const { pool } = fakePool();
        const recorder = recordSchemaChanges([pool]);
        for (let i = 0; i < 3; i++) await pool.query("CREATE TABLE t (id int)");

        expect(recorder.statements()).toHaveLength(3);
    });
});

describe("splitStatements", () => {
    it("splits at top-level semicolons only — never inside a string, an identifier, a dollar quote or a comment", () => {
        expect(splitStatements([
            "SET LOCAL lock_timeout = '1s';",
            "DO $grant$ BEGIN IF true THEN GRANT x TO y; END IF; END $grant$;",
            "COMMENT ON TABLE t IS 'a; b';",
            "CREATE TABLE \"odd;name\" (id int); -- trailing; comment",
            "CREATE FUNCTION f() RETURNS int AS $$ SELECT 1; $$ LANGUAGE sql;",
            "SELECT $1, a$b$c FROM t"
        ].join("\n"))).toEqual([
            "SET LOCAL lock_timeout = '1s'",
            "DO $grant$ BEGIN IF true THEN GRANT x TO y; END IF; END $grant$",
            "COMMENT ON TABLE t IS 'a; b'",
            "CREATE TABLE \"odd;name\" (id int)",
            "CREATE FUNCTION f() RETURNS int AS $$ SELECT 1; $$ LANGUAGE sql",
            "SELECT $1, a$b$c FROM t"
        ]);
    });
});

describe("renderSchemaChangeScript", () => {
    it("is a script psql can run: each statement terminated once, indentation of the source removed", () => {
        const script = renderSchemaChangeScript([
            "\n            CREATE TABLE IF NOT EXISTS rebase.jobs (\n                id TEXT PRIMARY KEY\n            )\n        ",
            "DO $grant$ BEGIN NULL; END $grant$;"
        ], { runtimeVersion: "0.26.0", database: "db.internal:5432/app" });

        expect(script).toContain("CREATE TABLE IF NOT EXISTS rebase.jobs (\n    id TEXT PRIMARY KEY\n);");
        expect(script).toContain("DO $grant$ BEGIN NULL; END $grant$;");
        expect(script).not.toContain(";;");
        expect(script).toContain("-- Runtime: @rebasepro/server 0.26.0");
        expect(script).toContain("-- Recorded against: db.internal:5432/app");
        expect(script).toContain("-- Statements: 2");
    });

    it("says not to wrap it in a transaction only when it builds an index concurrently", () => {
        expect(renderSchemaChangeScript(["CREATE INDEX CONCURRENTLY i ON t (c)"], {})).toContain("psql -1");
        expect(renderSchemaChangeScript(["CREATE INDEX i ON t (c)"], {})).not.toContain("psql -1");
    });

    it("says so when there was nothing to change", () => {
        expect(renderSchemaChangeScript([], {})).toContain("Nothing to change");
    });

    it("is the same text for the same statements — no timestamp, so two releases' scripts diff cleanly", () => {
        expect(renderSchemaChangeScript(["CREATE TABLE t (id int)"], {}))
            .toBe(renderSchemaChangeScript(["CREATE TABLE t (id int)"], {}));
    });
});

describe("describeDatabase", () => {
    it("names the host and database and never the credentials", () => {
        expect(describeDatabase("postgres://admin:s3cret@db.internal:5432/app?sslmode=require")).toBe("db.internal:5432/app");
        expect(describeDatabase(undefined)).toBeUndefined();
        expect(describeDatabase("not a url")).toBeUndefined();
    });
});
