import { describe, expect, it } from "@jest/globals";
import { assertCallerSql, maskSqlLiterals } from "./caller-sql";

const allowed = (text: string) => expect(() => assertCallerSql(text)).not.toThrow();
const refused = (text: string) => expect(() => assertCallerSql(text)).toThrow(expect.objectContaining({ code: "SQL_NOT_ALLOWED" }));

describe("assertCallerSql", () => {
    it("lets through one plain read or write", () => {
        allowed("SELECT lower(artist), count(*) FROM songs WHERE lang = $1 GROUP BY 1");
        allowed("  with t as (select 1) select * from t;  ");
        allowed("(SELECT 1) UNION (SELECT 2)");
        allowed("VALUES (1), (2)");
        allowed("TABLE songs");
        allowed("INSERT INTO songs (artist) VALUES ($1) RETURNING id");
        allowed("UPDATE songs SET artist = $1 WHERE id = $2");
        allowed("DELETE FROM songs WHERE id = $1");
        allowed("MERGE INTO songs s USING (VALUES (1)) v(id) ON s.id = v.id WHEN MATCHED THEN DO NOTHING");
    });

    it("reads past literals, dollar quotes and comments", () => {
        allowed("SELECT 'a;b', 'set_config(', E'it\\'s; RESET ROLE' FROM songs");
        allowed("SELECT $$; SET ROLE postgres$$, $tag$ pg_settings $tag$");
        allowed("SELECT 1 -- ; RESET ROLE\n");
        allowed("SELECT 1 /* outer /* ; set_config( */ still comment */");
        allowed("SELECT $1, $2::int");
    });

    it("refuses more than one statement", () => {
        refused("SELECT 1; RESET ROLE");
        refused("SELECT 1; SELECT 2");
        refused("SELECT 1 /* */ ; DELETE FROM songs");
    });

    it("refuses what can change the session or isn't a query", () => {
        refused("RESET ROLE");
        refused("SET ROLE postgres");
        refused("SET LOCAL app.uid = 'bob'");
        refused("reset all");
        refused("DISCARD ALL");
        refused("DO $$ BEGIN PERFORM 1; END $$");
        refused("BEGIN");
        refused("COMMIT");
        refused("PREPARE p AS SELECT 1");
        refused("CREATE TABLE x (id int)");
        refused("DROP TABLE songs");
        refused("COPY songs TO STDOUT");
        refused("");
        refused("   ;  ");
    });

    it("refuses set_config and pg_settings however they are spelled", () => {
        refused("SELECT set_config('app.uid', 'bob', true)");
        refused("SELECT pg_catalog.set_config('role', 'postgres', true)");
        refused("SELECT \"set_config\" ('app.uid', $1, true)");
        refused("WITH x AS (SELECT SET_CONFIG('app.uid', $1, true)) SELECT * FROM songs");
        refused("UPDATE pg_settings SET setting = 'bob' WHERE name = 'app.uid'");
        refused("UPDATE pg_catalog.\"pg_settings\" SET setting = 'bob'");
        refused("SELECT U&\"set\\005fconfig\"('app.uid', 'bob', true)");
        refused("SELECT set_config/**/('app.uid', 'bob', true)");
    });

    it("does not take a column that merely contains the name for it", () => {
        allowed("SELECT my_set_config, pg_settings_copy FROM songs");
    });
});

describe("maskSqlLiterals", () => {
    it("blanks strings and comments but keeps quoted identifiers", () => {
        expect(maskSqlLiterals("SELECT 'x' AS \"a;b\" -- c")).toBe("SELECT   AS \"a;b\"  ");
    });
});
