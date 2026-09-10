import { firstSqlRow, sqlRows } from "../src/util/sql-rows";

describe("sqlRows", () => {
    it("reads the array shape", () => {
        const rows = [{ id: 1 }, { id: 2 }];
        expect(sqlRows(rows)).toEqual(rows);
    });

    it("reads the node-postgres `{ rows }` envelope", () => {
        // The shape that is off-contract every time it turns up, and turns up
        // anyway. Reading only the other one is how a store sees nothing.
        expect(sqlRows({ rows: [{ id: 1 }], command: "SELECT", rowCount: 1 })).toEqual([{ id: 1 }]);
    });

    it("returns an empty array for a result carrying neither", () => {
        expect(sqlRows(undefined)).toEqual([]);
        expect(sqlRows(null)).toEqual([]);
        expect(sqlRows({})).toEqual([]);
        expect(sqlRows({ rows: null })).toEqual([]);
        expect(sqlRows(42)).toEqual([]);
    });

    it("keeps an empty result empty rather than absent", () => {
        expect(sqlRows([])).toEqual([]);
        expect(sqlRows({ rows: [] })).toEqual([]);
    });
});

describe("firstSqlRow", () => {
    it("reads the first row of either shape", () => {
        expect(firstSqlRow([{ ok: true }])).toEqual({ ok: true });
        expect(firstSqlRow({ rows: [{ ok: true }] })).toEqual({ ok: true });
    });

    it("is undefined when there are no rows", () => {
        // The advisory-lock claim in the reference app's reseed reads this: a
        // falsy answer means "someone else holds it". An envelope-only read
        // returned undefined for the array shape too, so the reseed reported a
        // lock nobody was holding and silently did nothing.
        expect(firstSqlRow([])).toBeUndefined();
        expect(firstSqlRow({ rows: [] })).toBeUndefined();
        expect(firstSqlRow(undefined)).toBeUndefined();
    });
});
