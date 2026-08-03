/**
 * The CHECK-constraint parser.
 *
 * The core of this file is the first block: every expression is a string a real
 * PostgreSQL server produced from `test/fixtures/real-schemas/constraint-shapes.sql`
 * and `pg_get_constraintdef`, captured into `constraint-shapes.json`. That
 * matters more than the volume of cases — the parser reads *rendered* SQL, and
 * the rendering is nothing like the input (`price > 0` on a numeric column
 * becomes `(price > (0)::numeric)`, `> -50` becomes `> '-50'::integer`). Cases
 * written by hand would test the parser against a guess at that rendering.
 *
 * The blocks after it are shapes no fixture happens to contain, or invariants
 * about *refusing* to parse — the half that keeps the generator from inventing
 * validation the database does not enforce.
 */
import fs from "node:fs";
import path from "node:path";

import {
    parseCheckConstraints,
    parseCheckDefinition,
    stripCasts,
    unwrapParens,
    type ColumnCheckFacts
} from "../src/schema/introspect-db-constraints";
import { loadRealSchema, check } from "./helpers/schema-metadata";

/** Facts for one column of the real `constraint_shapes` table. */
function realFacts(column: string): ColumnCheckFacts | undefined {
    const { metadata } = loadRealSchema("constraint-shapes");
    return parseCheckConstraints(metadata.checks).get("constraint_shapes")?.get(column);
}

function factsFor(definition: string, column: string): ColumnCheckFacts | undefined {
    return parseCheckDefinition(definition).get(column);
}

// ═══════════════════════════════════════════════════════════════════════
// Against real `pg_get_constraintdef` output
// ═══════════════════════════════════════════════════════════════════════
describe("parsing real PostgreSQL constraint definitions", () => {
    it("reads an exclusive lower bound written as `> 0` on a numeric column", () => {
        // Rendered by the server as `((price > (0)::numeric))`.
        expect(realFacts("price")).toEqual({ moreThan: 0 });
    });

    it("reads a two-sided inclusive range", () => {
        expect(realFacts("rating")).toEqual({ min: 1, max: 5 });
    });

    it("reads bounds whose literals carry a float cast", () => {
        // `(discount >= (0)::double precision)` — the cast name contains a space.
        expect(realFacts("discount")).toEqual({ min: 0, max: 1 });
    });

    it("reads a negative bound, which the server renders as a quoted literal", () => {
        // `(temperature > '-50'::integer)` — not a bare -50.
        expect(realFacts("temperature")).toEqual({ moreThan: -50, lessThan: 60 });
    });

    it("reads decimal literals", () => {
        expect(realFacts("percent")).toEqual({ min: 0, max: 100 });
    });

    it("pins a column constrained by equality to a number, as bounds not an enum", () => {
        // A one-value dropdown for a number would be absurd; bounds say the same
        // thing in the shape the field can use.
        expect(realFacts("exact_count")).toEqual({ min: 42, max: 42 });
    });

    it("reads `IN (…)` on a text column, which the server rewrites to `= ANY (ARRAY[…])`", () => {
        expect(realFacts("visibility")).toEqual({ enumValues: ["public", "private"] });
    });

    it("reads a value set on a varchar column, whose rendering casts both sides", () => {
        // `((tier)::text = ANY ((ARRAY['free'::character varying, …])::text[]))`
        expect(realFacts("tier")).toEqual({ enumValues: ["free", "pro", "enterprise"] });
    });

    it("unescapes doubled quotes inside literal values", () => {
        expect(realFacts("apostrophe_set")).toEqual({ enumValues: ["it's", "won't"] });
    });

    it("reads a single-value equality on a text column as a one-value set", () => {
        expect(realFacts("pinned_kind")).toEqual({ enumValues: ["only-one"] });
    });

    it("reads char_length as a string length bound", () => {
        expect(realFacts("code")).toEqual({ lengthMax: 10 });
    });

    it("reads a two-sided length range", () => {
        expect(realFacts("slug")).toEqual({ lengthMin: 3, lengthMax: 64 });
    });

    it("reads an exact length as both bounds", () => {
        expect(realFacts("fixed_len")).toEqual({ lengthMin: 8, lengthMax: 8 });
    });

    it("intersects two separate constraints on the same column", () => {
        // The column CHECK allows three values; `status_not_legacy` allows those
        // three plus "legacy". Both hold, so only the three survive.
        expect(realFacts("status")).toEqual({ enumValues: ["draft", "published", "archived"] });
    });

    it("merges bounds that arrive from different constraints", () => {
        // `quantity >= 1` inline, `quantity <= 1000` as a named table constraint.
        expect(realFacts("quantity")).toEqual({ min: 1, max: 1000 });
    });
});

// ═══════════════════════════════════════════════════════════════════════
// Refusals — real definitions the parser must not half-read
// ═══════════════════════════════════════════════════════════════════════
describe("refusing real constraint definitions it cannot fully read", () => {
    const unreadable = [
        ["a comparison between two columns", "start_day", "end_day"],
        ["a disjunction", "either_way", undefined],
        ["a LIKE pattern", "email", undefined],
        ["a function call on the left", "payload", undefined],
        ["negative membership (`<> ALL`)", "not_reserved", undefined]
    ] as const;

    it.each(unreadable)("yields nothing for %s", (_label, column, other) => {
        expect(realFacts(column)).toBeUndefined();
        if (other) expect(realFacts(other)).toBeUndefined();
    });

    it("leaves the readable constraints on the table unaffected", () => {
        // The refusals above share a table with fifteen readable constraints; a
        // refusal must not abandon the table.
        const { metadata } = loadRealSchema("constraint-shapes");
        const table = parseCheckConstraints(metadata.checks).get("constraint_shapes");
        expect(table?.size).toBe(15);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// Shapes and invariants beyond the fixture
// ═══════════════════════════════════════════════════════════════════════
describe("parseCheckDefinition", () => {
    it("returns nothing for text that is not a CHECK definition", () => {
        expect(parseCheckDefinition("UNIQUE (email)").size).toBe(0);
        expect(parseCheckDefinition("FOREIGN KEY (a) REFERENCES b(id)").size).toBe(0);
        expect(parseCheckDefinition("").size).toBe(0);
    });

    it("ignores a trailing NOT VALID", () => {
        expect(factsFor("CHECK ((quantity >= 1)) NOT VALID", "quantity")).toEqual({ min: 1 });
    });

    it("reads a quoted, mixed-case column name", () => {
        expect(factsFor('CHECK (("unitPrice" > (0)::numeric))', "unitPrice")).toEqual({ moreThan: 0 });
    });

    it("keeps the tighter of two bounds in the same direction", () => {
        expect(factsFor("CHECK (((n >= 5) AND (n >= 10)))", "n")).toEqual({ min: 10 });
        expect(factsFor("CHECK (((n <= 100) AND (n <= 50)))", "n")).toEqual({ max: 50 });
    });

    it("distinguishes inclusive from exclusive bounds", () => {
        expect(factsFor("CHECK ((n >= 0))", "n")).toEqual({ min: 0 });
        expect(factsFor("CHECK ((n > 0))", "n")).toEqual({ moreThan: 0 });
        expect(factsFor("CHECK ((n <= 9))", "n")).toEqual({ max: 9 });
        expect(factsFor("CHECK ((n < 9))", "n")).toEqual({ lessThan: 9 });
    });

    it("converts exclusive length comparisons to inclusive ones", () => {
        // There is no "exclusive length" validation rule, and lengths are whole
        // numbers, so `> 2` is exactly `>= 3`.
        expect(factsFor("CHECK ((length(s) > 2))", "s")).toEqual({ lengthMin: 3 });
        expect(factsFor("CHECK ((length(s) < 9))", "s")).toEqual({ lengthMax: 8 });
    });

    it("accepts every length function Postgres renders", () => {
        for (const fn of ["length", "char_length", "character_length", "octet_length"]) {
            expect(factsFor(`CHECK ((${fn}(s) <= 4))`, "s")).toEqual({ lengthMax: 4 });
        }
    });

    it("does not treat an arbitrary function call as a length", () => {
        expect(parseCheckDefinition("CHECK ((upper(s) = 'A'::text))").size).toBe(0);
    });

    it("refuses a constraint mixing a readable and an unreadable conjunct", () => {
        // Keeping the readable half would assert a rule narrower than the
        // database's, and the form would reject rows the database accepts.
        expect(parseCheckDefinition("CHECK (((n >= 1) AND (n < other_column)))").size).toBe(0);
    });

    it("refuses a constraint whose conjuncts name two columns", () => {
        expect(parseCheckDefinition("CHECK (((a >= 1) AND (b <= 5)))").size).toBe(0);
    });

    it("intersects two value sets within one constraint", () => {
        const facts = factsFor(
            "CHECK (((s = ANY (ARRAY['a'::text, 'b'::text, 'c'::text])) AND (s = ANY (ARRAY['b'::text, 'c'::text]))))",
            "s"
        );
        expect(facts).toEqual({ enumValues: ["b", "c"] });
    });

    it("reads a numeric value set", () => {
        expect(factsFor("CHECK ((n = ANY (ARRAY[1, 2, 3])))", "n")).toEqual({ enumValues: ["1", "2", "3"] });
    });

    it("refuses a value set containing a non-literal", () => {
        expect(parseCheckDefinition("CHECK ((s = ANY (ARRAY['a'::text, other_col])))").size).toBe(0);
    });

    it("refuses an empty value set", () => {
        expect(parseCheckDefinition("CHECK ((s = ANY (ARRAY[])))").size).toBe(0);
    });

    it("does not split on AND or OR inside a string literal", () => {
        expect(factsFor("CHECK ((s = 'this AND that'::text))", "s")).toEqual({ enumValues: ["this AND that"] });
        expect(factsFor("CHECK ((s = 'a OR b'::text))", "s")).toEqual({ enumValues: ["a OR b"] });
    });

    it("does not split on AND inside an identifier", () => {
        // `brand` and `android_id` both contain the letters of a separator.
        expect(factsFor("CHECK ((brand = 'acme'::text))", "brand")).toEqual({ enumValues: ["acme"] });
        expect(factsFor("CHECK ((android_id >= 1))", "android_id")).toEqual({ min: 1 });
    });

    it("does not split a value list on a comma inside a literal", () => {
        expect(factsFor("CHECK ((s = ANY (ARRAY['a,b'::text, 'c'::text])))", "s"))
            .toEqual({ enumValues: ["a,b", "c"] });
    });

    it("ignores a bound that is not a literal number", () => {
        expect(parseCheckDefinition("CHECK ((n >= (SELECT max(x) FROM t)))").size).toBe(0);
    });
});

describe("parseCheckConstraints", () => {
    it("groups facts by table", () => {
        const facts = parseCheckConstraints([
            check("orders", "CHECK ((total >= 0))"),
            check("products", "CHECK ((stock >= 0))")
        ]);
        expect(facts.get("orders")?.get("total")).toEqual({ min: 0 });
        expect(facts.get("products")?.get("stock")).toEqual({ min: 0 });
    });

    it("omits tables whose constraints are all unreadable", () => {
        const facts = parseCheckConstraints([check("t", "CHECK ((a < b))")]);
        expect(facts.has("t")).toBe(false);
    });

    it("is unaffected by constraint ordering", () => {
        const rows = [
            check("t", "CHECK ((n <= 100))", "upper"),
            check("t", "CHECK ((n >= 1))", "lower")
        ];
        const forward = parseCheckConstraints(rows).get("t")?.get("n");
        const backward = parseCheckConstraints([...rows].reverse()).get("t")?.get("n");
        expect(forward).toEqual({ min: 1, max: 100 });
        expect(backward).toEqual(forward);
    });

    it("reads every check in the real fixture without throwing", () => {
        const { metadata } = loadRealSchema("constraint-shapes");
        expect(metadata.checks.length).toBeGreaterThan(20);
        expect(() => parseCheckConstraints(metadata.checks)).not.toThrow();
    });
});

// ═══════════════════════════════════════════════════════════════════════
// The text helpers, which every rule above stands on
// ═══════════════════════════════════════════════════════════════════════
describe("unwrapParens", () => {
    it("removes nested wrapping parentheses", () => {
        expect(unwrapParens("(((a)))")).toBe("a");
    });

    it("keeps parentheses that are not a wrapper", () => {
        expect(unwrapParens("(a) AND (b)")).toBe("(a) AND (b)");
    });

    it("does not treat a parenthesis inside a literal as structure", () => {
        expect(unwrapParens("('a)b')")).toBe("'a)b'");
    });
});

describe("stripCasts", () => {
    it.each([
        ["(0)::numeric", "0"],
        ["'draft'::text", "'draft'"],
        ["(1)::double precision", "1"],
        ["(ARRAY['a'::text])::text[]", "ARRAY['a'::text]"],
        ["'x'::character varying(20)", "'x'"],
        ["(tier)::text", "tier"],
        ["plain_column", "plain_column"]
    ])("strips %s to %s", (input, expected) => {
        expect(stripCasts(input)).toBe(expected);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// The fixture itself
// ═══════════════════════════════════════════════════════════════════════
describe("the constraint fixture", () => {
    it("was captured from the committed SQL, so the two cannot drift apart", () => {
        const sql = fs.readFileSync(
            path.join(__dirname, "fixtures", "real-schemas", "constraint-shapes.sql"),
            "utf-8"
        ).replace(/^\s*--.*$/gm, "");
        const { metadata } = loadRealSchema("constraint-shapes");
        const captured = new Set(metadata.checks.map((c) => c.constraint_name));

        // Every explicitly named constraint in the SQL must appear in the capture.
        for (const [, name] of sql.matchAll(/CONSTRAINT\s+(\w+)\s+CHECK/g)) {
            expect(captured.has(name)).toBe(true);
        }
        // And every CHECK in the SQL produced one in the database.
        expect(metadata.checks.length).toBe(sql.match(/CHECK\s*\(/g)?.length);
    });
});
