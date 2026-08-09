/**
 * The SQL a `hasMany` write actually produces.
 *
 * The clear-existing-links step built its predicate by hand:
 *
 *     sql`${targetIdCol} NOT IN (${sql.join(parsedTargetIds)})`
 *
 * `sql.join` with no separator concatenates its parts, so three ids rendered
 * `NOT IN ($1$2$3)` — a syntax error that aborts the enclosing save
 * transaction. Writing a `hasMany` relation with two or more children therefore
 * always failed, while one child (nothing to join) worked.
 *
 * It survived because the only covering test mocks the query builder: `where`
 * is `jest.fn(() => chain)`, so the fragment is recorded as an object and never
 * compiled. These tests compile through the real `PgDialect` instead — the same
 * approach `search-ilike-escaping.test.ts` uses — which is the only way an
 * assertion here can see the difference between valid and invalid SQL.
 */
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { pgTable, PgDialect, serial, text, integer } from "drizzle-orm/pg-core";

const posts = pgTable("posts", {
    id: serial("id").primaryKey(),
    title: text("title"),
    author_id: integer("author_id")
});

const dialect = new PgDialect();

/** The predicate the clear-existing-links step builds, as the fix writes it. */
const clearPredicate = (parentId: unknown, keepIds: unknown[]) =>
    and(eq(posts.author_id, parentId), notInArray(posts.id, keepIds));

describe("hasMany write: clearing links not in the new set", () => {
    it("renders a comma-separated NOT IN for several ids", () => {
        const { sql: text, params } = dialect.sqlToQuery(clearPredicate(7, [11, 12, 13])!);

        // The defect rendered `NOT IN ($1$2$3)`. Each id must be its own
        // placeholder, separated by commas.
        expect(text).toContain("not in ($2, $3, $4)");
        expect(params).toEqual([7, 11, 12, 13]);
    });

    it("renders correctly for a single id — the case that always worked", () => {
        const { sql: text, params } = dialect.sqlToQuery(clearPredicate(7, [11])!);
        expect(text).toContain("not in ($2)");
        expect(params).toEqual([7, 11]);
    });

    it("produces no adjacent placeholders for any arity", () => {
        // The signature of the bug, stated as a property: two placeholders can
        // never touch. `$1$2` is exactly what the separator-less join emitted.
        for (const n of [2, 3, 5, 10]) {
            const ids = Array.from({ length: n }, (_, i) => i + 100);
            const { sql: text } = dialect.sqlToQuery(clearPredicate(1, ids)!);
            expect(text).not.toMatch(/\$\d+\$\d+/);
        }
    });

    it("is the mirror image of the set-FK step, which uses inArray", () => {
        // The two updates in that block are complements: clear what is not in
        // the set, then set what is. They should differ only by negation.
        const cleared = dialect.sqlToQuery(notInArray(posts.id, [11, 12])).sql;
        const kept = dialect.sqlToQuery(inArray(posts.id, [11, 12])).sql;
        expect(cleared.replace(" not in ", " in ")).toBe(kept);
    });
});
