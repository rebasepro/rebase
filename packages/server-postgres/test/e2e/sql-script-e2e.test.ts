/**
 * E2E: what a SQL console script returns, read off a real Postgres.
 *
 * The console wrote an edited cell back to a row it found by guessing, from
 * the query's text, which table the cell belonged to and which column held its
 * key. For `SELECT p.id, a.name FROM posts p JOIN authors a …` the guess was
 * `UPDATE authors SET name = … WHERE id = <the post's id>`, and for
 * `lower(email) AS name` it was `UPDATE users SET name = …`.
 *
 * Postgres says where each column came from — the table and attribute of every
 * field of a row description, or zero for a computed one — and
 * `runSqlScript` reads it. These cases pin what a real server reports, since
 * the console's edit rules (`studio/src/utils/sql_utils.ts`) are tested against
 * a restatement of it.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";

let container: PgContainer;
let pool: pg.Pool;
let driver: PostgresBackendDriver;

beforeAll(async () => {
    container = await startPgContainer();
    pool = new pg.Pool({ connectionString: container.connectionString, max: 3 });
    const db = drizzle(pool);
    const registry = new PostgresCollectionRegistry();
    driver = new PostgresBackendDriver(db, new RealtimeService(db, registry), registry);
    await pool.query(`
        CREATE TABLE authors (id int PRIMARY KEY, name text, mentor_id int);
        CREATE TABLE posts (id int PRIMARY KEY, author_id int, title text, tags text[], body bytea, meta jsonb, price numeric(10,2), published_at timestamp);
        CREATE TABLE settings (key text, value text);
        CREATE TABLE events (id int PRIMARY KEY, kind text);
        CREATE TABLE login_events () INHERITS (events);
        CREATE VIEW post_titles AS SELECT id, title FROM posts;
        CREATE SCHEMA archive;
        CREATE TABLE archive.orders (order_no int PRIMARY KEY, status text);
        CREATE TABLE order_items (order_id int, item_id int, quantity int, PRIMARY KEY (order_id, item_id));
        CREATE TABLE accounts (id int PRIMARY KEY, balance int);
        INSERT INTO accounts VALUES (1, 100);
        CREATE ROLE console_reader NOLOGIN;
        GRANT SELECT ON ALL TABLES IN SCHEMA public TO console_reader;
        INSERT INTO authors VALUES (1, 'Ada', NULL), (2, 'Grace', 1);
        INSERT INTO posts VALUES
            (1, 2, 'First', '{red,"two words"}', '\\x0102', '{"a": [1, 2]}', 12.30, '2026-01-02 03:04:05.123456'),
            (2, 1, '', NULL, NULL, NULL, NULL, NULL);
    `);
}, 180_000);

afterAll(async () => {
    await pool?.end();
    if (container) await stopPgContainer(container.containerName);
});

describe("where each column of a result was read from", () => {
    it("names each side of a join by its own table — the post's id is the post's", async () => {
        const result = await driver.runSqlScript("SELECT p.id, a.name FROM posts p JOIN authors a ON a.id = p.author_id ORDER BY p.id");

        expect(result.columns).toEqual([
            { name: "id", type: "integer", source: { schema: "public", table: "posts", column: "id" } },
            { name: "name", type: "text", source: { schema: "public", table: "authors", column: "name" } }
        ]);
        expect(result.tables).toEqual(expect.arrayContaining([
            { schema: "public", table: "posts", kind: "table", primaryKey: ["id"], hasInheritors: false },
            { schema: "public", table: "authors", kind: "table", primaryKey: ["id"], hasInheritors: false }
        ]));
        expect(result.rows).toEqual([{ id: "1", name: "Grace" }, { id: "2", name: "Ada" }]);
    });

    it("gives an expression, a literal and an aggregate no source", async () => {
        const result = await driver.runSqlScript(
            "SELECT id, lower(title) AS title, 'archived' AS status, count(*) OVER () AS total FROM posts"
        );

        expect(result.columns.map(column => [column.name, column.source])).toEqual([
            ["id", { schema: "public", table: "posts", column: "id" }],
            ["title", undefined],
            ["status", undefined],
            ["total", undefined]
        ]);
    });

    it("reads through an alias, a subquery and a WITH query to the stored column", async () => {
        const result = await driver.runSqlScript(
            "WITH x AS (SELECT id, title FROM posts) SELECT s.id AS post_key, s.title AS headline FROM (SELECT * FROM x) s"
        );

        expect(result.columns.map(column => column.source)).toEqual([
            { schema: "public", table: "posts", column: "id" },
            { schema: "public", table: "posts", column: "title" }
        ]);
    });

    it("gives a UNION's columns no source, whichever table each row came from", async () => {
        const result = await driver.runSqlScript("SELECT id, name FROM authors UNION ALL SELECT order_no, status FROM archive.orders");

        expect(result.columns.every(column => column.source === undefined)).toBe(true);
    });

    it("says what each table is: a view, a keyless table, one others inherit, a composite key, another schema", async () => {
        const result = await driver.runSqlScript(`
            SELECT v.id, s.key, e.kind, oi.quantity, o.status
              FROM post_titles v, settings s, events e, order_items oi, archive.orders o`);

        const byName = Object.fromEntries(result.tables.map(t => [`${t.schema}.${t.table}`, t]));
        expect(byName["public.post_titles"]).toMatchObject({ kind: "view", primaryKey: [] });
        expect(byName["public.settings"]).toMatchObject({ kind: "table", primaryKey: [], hasInheritors: false });
        expect(byName["public.events"]).toMatchObject({ kind: "table", primaryKey: ["id"], hasInheritors: true });
        expect(byName["public.order_items"]).toMatchObject({ primaryKey: ["order_id", "item_id"] });
        expect(byName["archive.orders"]).toMatchObject({ kind: "table", primaryKey: ["order_no"] });
    });
});

describe("what a script returns", () => {
    it("returns the rows of its last statement", async () => {
        const result = await driver.runSqlScript("SELECT 1 AS a; SELECT 2 AS b");

        expect(result.rows).toEqual([{ b: "2" }]);
        expect(result.columns.map(column => column.name)).toEqual(["b"]);
        expect(result.command).toBe("SELECT");
        expect(result.rowCount).toBe(1);
    });

    it("says what a last statement with no rows did, and to how many", async () => {
        const result = await driver.runSqlScript("SELECT 1; UPDATE posts SET title = title WHERE id IN (1, 2)");

        expect(result.rows).toEqual([]);
        expect(result.command).toBe("UPDATE");
        expect(result.rowCount).toBe(2);
    });

    it("returns every value as the text Postgres writes for it, and NULL apart from an empty string", async () => {
        const result = await driver.runSqlScript("SELECT id, title, tags, body, meta, price, published_at FROM posts ORDER BY id");

        expect(result.rows).toEqual([
            {
                id: "1",
                title: "First",
                tags: "{red,\"two words\"}",
                body: "\\x0102",
                meta: "{\"a\": [1, 2]}",
                price: "12.30",
                published_at: "2026-01-02 03:04:05.123456"
            },
            { id: "2", title: "", tags: null, body: null, meta: null, price: null, published_at: null }
        ]);
        expect(result.columns.map(column => column.type)).toEqual([
            "integer", "text", "text[]", "bytea", "jsonb", "numeric", "timestamp without time zone"
        ]);
    });

    it("writes back what it read: every value round-trips through its text", async () => {
        const read = await driver.runSqlScript("SELECT tags, body, meta, price, published_at FROM posts WHERE id = 1");
        const row = read.rows[0];
        const literal = (value: string | null) => value === null ? "NULL" : `'${value.replace(/'/g, "''")}'`;

        await driver.runSqlScript(
            `UPDATE posts SET tags = ${literal(row.tags)}, body = ${literal(row.body)}, meta = ${literal(row.meta)}, ` +
            `price = ${literal(row.price)}, published_at = ${literal(row.published_at)} WHERE id = 1`
        );

        const again = await driver.runSqlScript("SELECT tags, body, meta, price, published_at FROM posts WHERE id = 1");
        expect(again.rows).toEqual(read.rows);
    });
});

/**
 * A transaction split across runs was silently not one. Each run gets a
 * session of its own, so `BEGIN`, then `UPDATE accounts SET balance = 0`, then
 * `ROLLBACK` — three runs — committed the update, and all three said success:
 * the `BEGIN` session was destroyed with its transaction, the UPDATE committed
 * on its own, and the ROLLBACK's "there is no transaction in progress" was a
 * warning nobody showed.
 */
describe("a transaction and the run it began in", () => {
    const balance = async () => (await pool.query("SELECT balance FROM accounts WHERE id = 1")).rows[0].balance;

    it("refuses a run that leaves a transaction open, and keeps nothing it did", async () => {
        await expect(driver.runSqlScript("BEGIN; UPDATE accounts SET balance = 0 WHERE id = 1"))
            .rejects.toThrow(/began a transaction and did not end it[\s\S]*rolled back/);
        expect(await balance()).toBe(100);

        await expect(driver.runSqlScript("BEGIN")).rejects.toThrow(/did not end it/);
    });

    it("says a ROLLBACK or COMMIT with nothing to end did nothing", async () => {
        const rollback = await driver.runSqlScript("ROLLBACK");
        expect(rollback.notices).toEqual([{ severity: "WARNING", message: "there is no transaction in progress" }]);

        const commit = await driver.runSqlScript("COMMIT");
        expect(commit.notices).toEqual([{ severity: "WARNING", message: "there is no transaction in progress" }]);
    });

    it("keeps a transaction that begins and ends in one run", async () => {
        await driver.runSqlScript("BEGIN; UPDATE accounts SET balance = 50 WHERE id = 1; COMMIT");
        expect(await balance()).toBe(50);
        await driver.runSqlScript("BEGIN; UPDATE accounts SET balance = 0 WHERE id = 1; ROLLBACK");
        expect(await balance()).toBe(50);
        await pool.query("UPDATE accounts SET balance = 100 WHERE id = 1");
    });

    it("rolls back the transaction a failed run began, and says so", async () => {
        await expect(driver.runSqlScript("BEGIN; UPDATE accounts SET balance = 0 WHERE id = 1; SELECT 1/0"))
            .rejects.toThrow(/division by zero[\s\S]*rolled back/);
        expect(await balance()).toBe(100);
    });

    it("runs every statement as the role picked, a COMMIT in the middle included", async () => {
        const result = await driver.runSqlScript(
            "SELECT current_user AS before_commit; COMMIT; SELECT current_user AS after_commit",
            { role: "console_reader" }
        );
        expect(result.rows).toEqual([{ after_commit: "console_reader" }]);

        await expect(driver.runSqlScript("SELECT 1; COMMIT; CREATE TABLE made_by_reader (id int)", { role: "console_reader" }))
            .rejects.toThrow(/permission denied/);
    });

    it("leaves the next run on that pool its own session: no role, no setting, no transaction", async () => {
        await driver.runSqlScript("SET ROLE console_reader; SELECT set_config('app.leak', 'yes', false)");
        const after = await pool.query("SELECT current_user AS who, current_setting('app.leak', true) AS leak, now() = statement_timestamp() AS fresh");
        expect(after.rows[0].who).not.toBe("console_reader");
        expect(after.rows[0].leak).not.toBe("yes");
    });
});

/**
 * The plain `executeSql` door, with `isolateSession` — what the socket runs for
 * a client that does not ask for a script: the same refusal, and the role held
 * for the whole session.
 */
describe("executeSql on a session of its own", () => {
    it("refuses a transaction left open, and runs as the role past a COMMIT", async () => {
        await expect(driver.executeSql("BEGIN; UPDATE accounts SET balance = 0 WHERE id = 1", { isolateSession: true }))
            .rejects.toThrow(/did not end it/);
        expect((await pool.query("SELECT balance FROM accounts WHERE id = 1")).rows[0].balance).toBe(100);

        // Drizzle wraps the database's error; the socket reports the cause.
        await expect(driver.executeSql("SELECT 1; COMMIT; CREATE TABLE made_by_reader (id int)", { role: "console_reader", isolateSession: true }))
            .rejects.toMatchObject({ cause: expect.objectContaining({ message: expect.stringMatching(/permission denied/) }) });
        await expect(driver.executeSql("BEGIN; SELECT 1/0", { isolateSession: true }))
            .rejects.toMatchObject({ cause: expect.objectContaining({ message: expect.stringMatching(/division by zero[\s\S]*rolled back/) }) });
    });
});
