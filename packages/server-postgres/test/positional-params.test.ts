import { PgDialect } from "drizzle-orm/pg-core";
import { positionalStatement, splitPlaceholders } from "../src/utils/positional-params";

const params = (text: string) => splitPlaceholders(text).filter(piece => "param" in piece).map(piece => ("param" in piece ? piece.param : 0));
const render = (text: string, values: unknown[]) => new PgDialect().sqlToQuery(positionalStatement(text, values));

describe("positional parameters in raw SQL", () => {
    it("binds a reused $n once, and writes its later uses as the same number", () => {
        expect(render("SELECT $2, $1 WHERE a = $2 OR b = $1 OR c = $2", ["one", "two"])).toMatchObject({
            sql: "SELECT $1, $2 WHERE a = $1 OR b = $2 OR c = $1",
            params: ["two", "one"]
        });
    });

    it.each([
        ["a string literal", "SELECT '$1', $1", [1]],
        ["a doubled quote inside a literal", "SELECT 'it''s $1', $1", [1]],
        ["an escape string", "SELECT E'\\'$1', $1", [1]],
        ["a quoted identifier", "SELECT \"col$1\", $1", [1]],
        ["a line comment", "SELECT $1 -- not $2\n, 1", [1]],
        ["a nested block comment", "SELECT /* a /* $2 */ $3 */ $1", [1]],
        ["a dollar-quoted body", "SELECT $$ $2 $$, $fn$ $3 $fn$, $1", [1]],
        ["an identifier holding a $", "SELECT a$1, $1 FROM t", [1]]
    ])("leaves a $n inside %s alone", (_label, text, expected) => {
        expect(params(text)).toEqual(expected);
    });

    it("keeps every character of the text", () => {
        const text = "SELECT 'x$1' AS \"q$2\", $1::int /* $3 */ -- $4\n FROM t WHERE e = E'\\'' AND $$ $5 $$ = $2";
        const rebuilt = splitPlaceholders(text).map(piece => ("text" in piece ? piece.text : `$${piece.param}`)).join("");
        expect(rebuilt).toBe(text);
        expect(params(text)).toEqual([1, 2]);
    });

    it("leaves text without params as written", () => {
        expect(render("SELECT '$1'", [])).toMatchObject({ sql: "SELECT '$1'", params: [] });
    });
});
