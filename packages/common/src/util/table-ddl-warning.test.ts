import { findTableDdl, tableDdlMessage, warnOnTableDdl } from "./table-ddl-warning";

/**
 * The warning `rebase.sql()` logs when it is used to make application tables.
 *
 * The case it exists for is real: an agent building a game on Rebase put
 * twelve tables in a function as `CREATE TABLE IF NOT EXISTS`, with every read
 * and write as raw SQL, and nothing in the platform said a word. These tests pin
 * the statements an agent writes, the ones it must not catch (Rebase's own
 * tables, temporary tables, a `CREATE TABLE` inside a string) and that the
 * message names the fix.
 */
describe("table DDL guard", () => {

    it("finds the statements an agent writes in a function", () => {
        expect(findTableDdl("CREATE TABLE IF NOT EXISTS songbuzz_events (id bigserial PRIMARY KEY, kind text)")).toEqual([
            { statement: "create table", schema: "public", table: "songbuzz_events" }
        ]);
        expect(findTableDdl("create unlogged table Scores (n int)")).toEqual([
            { statement: "create table", schema: "public", table: "scores" }
        ]);
        expect(findTableDdl("ALTER TABLE songbuzz_solo_daily ADD COLUMN IF NOT EXISTS name text")).toEqual([
            { statement: "alter table", schema: "public", table: "songbuzz_solo_daily" }
        ]);
        expect(findTableDdl("DROP TABLE IF EXISTS public.old_scores")).toEqual([
            { statement: "drop table", schema: "public", table: "old_scores" }
        ]);
        expect(findTableDdl("CREATE INDEX IF NOT EXISTS songbuzz_events_at ON songbuzz_events (at)")).toEqual([
            { statement: "create index", schema: "public", table: "songbuzz_events" }
        ]);
        expect(findTableDdl("create unique index concurrently on only app.\"Orders\" (ref)")).toEqual([
            { statement: "create index", schema: "app", table: "Orders" }
        ]);
    });

    it("finds each statement in a script, after comments and leading whitespace", () => {
        const script = `
            -- the friends tables
            CREATE TABLE IF NOT EXISTS friend (a text, b text);
            /* who asked whom */ CREATE TABLE friend_ask (a text);
            CREATE INDEX friend_b ON friend (b);
        `;
        expect(findTableDdl(script).map(d => `${d.statement} ${d.table}`)).toEqual([
            "create table friend",
            "create table friend_ask",
            "create index friend"
        ]);
    });

    it("leaves queries, temporary tables and Rebase's own schemas alone", () => {
        expect(findTableDdl("SELECT count(*) AS total FROM jobs WHERE status = $1")).toEqual([]);
        expect(findTableDdl("INSERT INTO notes (body) VALUES ('CREATE TABLE x (a int)')")).toEqual([]);
        expect(findTableDdl("INSERT INTO notes (body) VALUES ($tag$; CREATE TABLE x (a int)$tag$)")).toEqual([]);
        expect(findTableDdl("CREATE TEMP TABLE scratch (a int)")).toEqual([]);
        expect(findTableDdl("CREATE TEMPORARY TABLE scratch (a int)")).toEqual([]);
        expect(findTableDdl("DROP TABLE pg_temp.scratch")).toEqual([]);
        // plugin-review keeps its staged changes in Rebase's own schema
        expect(findTableDdl("CREATE TABLE IF NOT EXISTS rebase.staged_changes (id uuid)")).toEqual([]);
        expect(findTableDdl("CREATE INDEX IF NOT EXISTS idx_staged ON rebase.staged_changes (status)")).toEqual([]);
        expect(findTableDdl("CREATE TABLE auth.sessions (id uuid)")).toEqual([]);
        expect(findTableDdl("CREATE EXTENSION IF NOT EXISTS pgcrypto")).toEqual([]);
    });

    it("tells the reader how to do it instead", () => {
        const message = tableDdlMessage({ statement: "create table", schema: "public", table: "songbuzz_events" });
        expect(message).toContain("CREATE TABLE songbuzz_events");
        expect(message).toContain("config/collections/songbuzz-events.ts");
        expect(message).toContain("defineCollection");
        expect(message).toContain("rebase.dataAsAdmin.<slug>");
        expect(message).toContain("pnpm schema:introspect");
        const index = tableDdlMessage({ statement: "create index", schema: "public", table: "songbuzz_events" });
        expect(index).toContain("`indexes`");
    });

    it("never throws, and warns once per table", () => {
        const warnings: string[] = [];
        const warn = (message: string) => warnings.push(message);
        expect(() => warnOnTableDdl("CREATE TABLE IF NOT EXISTS once_only (a int)", warn)).not.toThrow();
        warnOnTableDdl("CREATE TABLE IF NOT EXISTS once_only (a int)", warn);
        warnOnTableDdl("CREATE INDEX once_only_a ON once_only (a)", warn);
        warnOnTableDdl("SELECT 1", warn);
        expect(warnings).toHaveLength(2);
        expect(warnings[0]).toContain("The statement ran.");
    });
});
