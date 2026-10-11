import { dehydrateRow, hydrateRow } from "./offline-codec";

describe("a column named __proto__ (audit 34, L6)", () => {
    it("is carried through the offline store as a column, not taken as the row's prototype", () => {
        // `JSON.parse` makes `__proto__` an own property, as a response body would.
        const row = JSON.parse('{"id":"1","__proto__":{"isAdmin":true}}') as Record<string, unknown>;
        for (const out of [dehydrateRow(row), hydrateRow(dehydrateRow(row))]) {
            expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
            expect(Object.keys(out)).toEqual(["id", "__proto__"]);
            expect((out as { isAdmin?: unknown }).isAdmin).toBeUndefined();
            expect(Object.getOwnPropertyDescriptor(out, "__proto__")?.value).toEqual({ isAdmin: true });
        }
    });
});
