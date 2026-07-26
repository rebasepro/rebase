import { describe, expect, it } from "vitest";

import { findSubqueries, isBareIdent, matchParen, tokenize } from "./sql";

const values = (sql: string) => tokenize(sql).map((t) => t.value);

describe("tokenize", () => {
    it("keeps a string literal whole, whatever is inside it", () => {
        const tokens = tokenize("(note = 'EXISTS (SELECT 1 FROM t WHERE x)')");

        expect(tokens.filter((t) => t.kind === "string")).toHaveLength(1);
        expect(findSubqueries(tokens)).toEqual([]);
    });

    it("handles doubled quotes inside a literal", () => {
        expect(values("(a = 'it''s fine')")).toEqual(["(", "a", "=", "'it''s fine'", ")"]);
    });

    it("keeps dollar-quoted text whole", () => {
        const tokens = tokenize("(note = $tag$ ) ) EXISTS (SELECT $tag$)");

        expect(tokens.filter((t) => t.kind === "string")).toHaveLength(1);
        expect(findSubqueries(tokens)).toEqual([]);
    });

    it("preserves the case of a quoted identifier and lower-cases a bare one", () => {
        const tokens = tokenize('("MixedCase" = MixedCase)');

        expect(tokens[1]).toMatchObject({ value: "MixedCase", quoted: true });
        expect(tokens[3]).toMatchObject({ value: "mixedcase", quoted: false });
    });

    it("skips line and nested block comments", () => {
        expect(values("a /* outer /* inner */ still */ = -- trailing\n b")).toEqual(["a", "=", "b"]);
    });

    it("reads multi-character operators as one token", () => {
        expect(values("a <> b :: text")).toEqual(["a", "<>", "b", "::", "text"]);
    });

    it("does not split `||` into two ident characters", () => {
        expect(values("a || b")).toEqual(["a", "||", "b"]);
    });

    it("matches parens across nesting", () => {
        const tokens = tokenize("( a ( b ) c )");

        expect(matchParen(tokens, 0)).toBe(tokens.length - 1);
    });
});

describe("isBareIdent", () => {
    it("rejects a qualified reference on either side of the dot", () => {
        const tokens = tokenize("t.id = 1");

        expect(isBareIdent(tokens, 0)).toBe(false); // `t`, followed by `.`
        expect(isBareIdent(tokens, 2)).toBe(false); // `id`, preceded by `.`
    });

    it("rejects a function call", () => {
        const tokens = tokenize("lower(x)");

        expect(isBareIdent(tokens, 0)).toBe(false);
    });

    it("accepts a plain column name", () => {
        const tokens = tokenize("id = 1");

        expect(isBareIdent(tokens, 0)).toBe(true);
    });
});

describe("findSubqueries", () => {
    it("finds EXISTS, IN and scalar subqueries alike", () => {
        expect(findSubqueries(tokenize("EXISTS (SELECT 1 FROM t)"))).toHaveLength(1);
        expect(findSubqueries(tokenize("x IN (SELECT id FROM t)"))).toHaveLength(1);
        expect(findSubqueries(tokenize("x = (SELECT max(id) FROM t)"))).toHaveLength(1);
    });

    it("finds nested subqueries as separate ranges", () => {
        const found = findSubqueries(
            tokenize("EXISTS (SELECT 1 FROM a WHERE EXISTS (SELECT 1 FROM b))")
        );

        expect(found).toHaveLength(2);
        expect(found[1].open).toBeGreaterThan(found[0].open);
        expect(found[1].close).toBeLessThan(found[0].close);
    });

    it("ignores a parenthesised group that is not a subquery", () => {
        expect(findSubqueries(tokenize("(a = 1 AND (b = 2))"))).toEqual([]);
    });
});
