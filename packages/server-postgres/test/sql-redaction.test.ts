import { describe, it, expect } from "@jest/globals";
import { redactSqlLiterals } from "../src/utils/sql-redaction";

/**
 * The SQL console's audit line kept the statement verbatim, so a password set
 * from the console landed in the production logs. Every way Postgres lets one
 * be written must come out masked, and nothing else about the statement may
 * change — it is the audit signal.
 */
describe("redactSqlLiterals", () => {
    const SECRET = "hunter2";

    it.each([
        ["a role's password", `ALTER ROLE app PASSWORD '${SECRET}'`],
        ["an encrypted password at creation", `CREATE ROLE app LOGIN ENCRYPTED PASSWORD '${SECRET}' VALID UNTIL 'infinity'`],
        ["a user's password", `CREATE USER app WITH PASSWORD '${SECRET}'`],
        ["a password in dollar quotes", `ALTER ROLE app PASSWORD $$${SECRET}$$`],
        ["a password in tagged dollar quotes", `ALTER ROLE app PASSWORD $pw$${SECRET}$pw$`],
        ["a user mapping's options", `CREATE USER MAPPING FOR app SERVER remote OPTIONS (user 'app', password '${SECRET}')`],
        ["a libpq connection string", `SELECT dblink_connect('host=db user=app password=${SECRET}')`],
        ["a URL connection string", `SELECT dblink_connect('postgres://app:${SECRET}@db:5432/app')`],
        ["an escape string", `ALTER ROLE app PASSWORD E'${SECRET}\\'s'`],
        ["a doubled quote inside", `ALTER ROLE app PASSWORD 'it''s ${SECRET}'`],
        ["a DO block", `DO $$ BEGIN EXECUTE 'ALTER ROLE app PASSWORD ''${SECRET}'''; END $$`],
        ["a function body", `CREATE FUNCTION f() RETURNS void LANGUAGE sql AS $body$ SELECT set_config('app.key', '${SECRET}', false) $body$`],
        ["a key passed to pgcrypto", `SELECT pgp_sym_encrypt('card 4111', '${SECRET}')`],
        ["a quote in a comment before it", `-- don't log this\nALTER ROLE app PASSWORD '${SECRET}'`],
        ["a quote in a block comment before it", `/* it's /* nested */ here */ ALTER ROLE app PASSWORD '${SECRET}'`]
    ])("masks %s", (_label, sql) => {
        const redacted = redactSqlLiterals(sql);
        expect(redacted).not.toContain(SECRET);
    });

    it("keeps the statement's shape: keywords, identifiers, numbers and comments", () => {
        expect(redactSqlLiterals(`UPDATE "Users" SET email = 'alice@acme.com', age = 41 WHERE id = $1 -- fix`))
            .toBe(`UPDATE "Users" SET email = '***', age = 41 WHERE id = $1 -- fix`);
        expect(redactSqlLiterals(`ALTER ROLE app PASSWORD 'x'`)).toBe(`ALTER ROLE app PASSWORD '***'`);
        expect(redactSqlLiterals(`SELECT E'a\\'b', X'ff', U&'d\\0061t'`)).toBe(`SELECT E'***', X'***', U&'***'`);
    });

    it("does not take a quoted identifier, or a quote inside one, for a literal", () => {
        expect(redactSqlLiterals(`SELECT "it's" FROM t WHERE "x""y" = 'secret'`))
            .toBe(`SELECT "it's" FROM t WHERE "x""y" = '***'`);
    });

    it("reads a DO body as SQL: its structure stays, its literals go", () => {
        expect(redactSqlLiterals("DO $$ BEGIN RAISE NOTICE 'pw %', 'secret'; END $$"))
            .toBe("DO $$ BEGIN RAISE NOTICE '***', '***'; END $$");
    });

    it("masks to the end an unterminated literal", () => {
        expect(redactSqlLiterals("ALTER ROLE app PASSWORD 'hunter2")).toBe("ALTER ROLE app PASSWORD '***'");
    });
});
