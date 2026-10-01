import { decodeCursor, encodeCursor } from "../src/data/cursor";

/**
 * A listing sorted by an aggregate over a relation — `count(orders)`,
 * `min(applications.createdAt)` — pages by cursor.
 *
 * `sdk/relations.md` says so, and the driver is built for it: the aggregate is
 * not a column of the row, so the keyset comparison recomputes the cursor row's
 * value in SQL from the id the cursor carries. But the encoder refused any sort
 * key whose value was not on the row, so no cursor was ever issued for such a
 * listing: `meta.nextCursor` was absent beside `hasMore: true`, and the
 * documented `do { … } while (after)` loop stopped after the first page.
 */
describe("a cursor over a relation-aggregate sort", () => {
    const row = { id: 7, name: "Acme" };

    it("is issued, carrying the id and the stored keys", () => {
        const cursor = encodeCursor([["count(orders)", "desc"], ["name", "asc"]], row, 7);
        expect(cursor).toBeDefined();

        const decoded = decodeCursor(cursor!);
        expect(decoded.orderBy).toEqual([["count(orders)", "desc"], ["name", "asc"]]);
        expect(decoded.id).toBe(7);
        // Nothing to carry for the aggregate: the next page recomputes it.
        expect(decoded.values).toEqual({ name: "Acme" });
    });

    it("is issued for every aggregate the sort dialect names", () => {
        for (const key of ["min(applications.createdAt)", "max(applications.createdAt)", "sum(orders.total)", "avg(orders.total)"]) {
            expect(encodeCursor([[key, "asc"]], row, 7)).toBeDefined();
        }
    });

    it("is still withheld when a stored sort key is missing from the row", () => {
        // A column the row does not carry — a `fields` projection that left it
        // out — has no value to seek past, and no SQL recomputes it.
        expect(encodeCursor([["createdAt", "desc"]], row, 7)).toBeUndefined();
        expect(encodeCursor([["count(orders)", "desc"], ["createdAt", "desc"]], row, 7)).toBeUndefined();
    });
});
