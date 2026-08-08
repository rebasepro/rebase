/**
 * The default (un-opted-in) search must match the text the user typed.
 *
 * A collection with no `search` block falls back to `ILIKE '%term%'` across its
 * string properties, and the term was interpolated into the pattern raw. The
 * term is a bind parameter, so this was never SQL injection — it was two other
 * things:
 *
 *  - **a different query than the one asked for.** `%` and `_` are LIKE
 *    metacharacters, so `50%` matched every row and `a_c` matched `abc`, and no
 *    input could search for a literal `%`;
 *  - **an attacker-chosen cost.** Postgres matches LIKE by backtracking, so a
 *    pattern of alternating wildcards and letters is polynomial with an exponent
 *    the caller picks — per row, OR-ed across every string property, on a
 *    sequential scan that the page limit does not bound.
 *
 * This is the server half of `packages/client/src/like-pattern-redos.test.ts`,
 * which hardened the offline evaluator against the same pattern shape and noted
 * that on a driver the same expression "occupies a server thread instead".
 */
import { CollectionConfig } from "@rebasepro/types";
import { pgTable, PgDialect, serial, text } from "drizzle-orm/pg-core";
import { DrizzleConditionBuilder, escapeLikePattern } from "../src/utils/drizzle-conditions";

const docs = pgTable("docs", {
    id: serial("id").primaryKey(),
    title: text("title")
});

const collection: CollectionConfig = {
    slug: "docs",
    name: "Docs",
    table: "docs",
    properties: {
        id: { type: "number", isId: true },
        title: { type: "string" }
    },
    idField: "id"
};

/** The bound pattern the ILIKE condition would send. */
const patternFor = (searchString: string): string => {
    const conditions = DrizzleConditionBuilder.buildSearchConditions(
        searchString, collection.properties, docs, collection
    );
    expect(conditions).toHaveLength(1);
    const { params } = new PgDialect().sqlToQuery(conditions[0]);
    return String(params[0]);
};

describe("a search term is matched as literal text", () => {
    it("escapes a percent, so `50%` is a search for `50%`", () => {
        expect(patternFor("50%")).toBe("%50\\%%");
    });

    it("escapes an underscore, so `a_c` does not match `abc`", () => {
        expect(patternFor("a_c")).toBe("%a\\_c%");
    });

    it("escapes the escape character itself", () => {
        // Without this, a term ending in a backslash escapes the closing `%`
        // of the wrapper and the pattern means something else entirely.
        expect(patternFor("c:\\")).toBe("%c:\\\\%");
    });

    it("leaves an ordinary term exactly as it was", () => {
        expect(patternFor("auditor iso 14001")).toBe("%auditor iso 14001%");
    });

    it("gives a hostile pattern no wildcards to backtrack over", () => {
        // 14 alternating wildcards is the shape that took 100 seconds in the
        // client's own test. Escaped, the pattern has exactly the two wildcards
        // the substring search puts there.
        const hostile = "a%".repeat(14) + "b";
        const pattern = patternFor(hostile);

        expect(pattern.match(/(?<!\\)%/g)).toHaveLength(2);
        expect(pattern.startsWith("%")).toBe(true);
        expect(pattern.endsWith("%")).toBe(true);
    });
});

describe("escapeLikePattern", () => {
    it("touches nothing else", () => {
        expect(escapeLikePattern("O'Brien & Sons, 100€")).toBe("O'Brien & Sons, 100€");
    });
});
