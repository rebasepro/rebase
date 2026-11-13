/**
 * `isAddressableId`: whether an address could name a row at all, so a caller
 * answers 404 instead of sending Postgres a comparison it refuses (22P02).
 */
import { describe, expect, it } from "@jest/globals";
import { parseIdValues, type PrimaryKeyInfo } from "../src/util/identity";
import { isAddressableId } from "../src/runtime/addressable-id";

const numericId: PrimaryKeyInfo[] = [{ fieldName: "id", type: "number" }];
const stringSku: PrimaryKeyInfo[] = [{ fieldName: "sku", type: "string" }];
const uuidKey: PrimaryKeyInfo[] = [{ fieldName: "id", type: "string", isUUID: true }];
const composite: PrimaryKeyInfo[] = [
    { fieldName: "tenant_id", type: "number" },
    { fieldName: "user_id", type: "number" }
];

describe("isAddressableId", () => {

    it("accepts an id the key columns can actually hold", () => {
        expect(isAddressableId("3f2504e0-4f89-11d3-9a0c-0305e82c3301", uuidKey)).toBe(true);
        expect(isAddressableId("42", numericId)).toBe(true);
        expect(isAddressableId(42, numericId)).toBe(true);
        expect(isAddressableId("anything", stringSku)).toBe(true);
        expect(isAddressableId("1:::2", composite)).toBe(true);
    });

    it("rejects an id no row could have, so callers can answer 404", () => {
        // `/c/products/new` is the one that reaches users: a route segment that
        // was never an id at all.
        expect(isAddressableId("new", uuidKey)).toBe(false);
        expect(isAddressableId("not-a-number", numericId)).toBe(false);
        expect(isAddressableId("1", composite)).toBe(false);
        expect(isAddressableId("x:::2", composite)).toBe(false);
        expect(isAddressableId("12abc", numericId)).toBe(false);
        expect(isAddressableId("1:::2.5", composite)).toBe(false);
    });

    it("rejects everything for a collection with no key", () => {
        expect(isAddressableId("1", [])).toBe(false);
    });

    it("never calls addressable an id parseIdValues refuses to build", () => {
        // A gap in this direction is a 500: the caller decides to query, and
        // then the query cannot be built. The reverse gap is allowed — see the
        // UUID case, where only the column knows.
        const cases: [string, PrimaryKeyInfo[]][] = [
            ["3f2504e0-4f89-11d3-9a0c-0305e82c3301", uuidKey],
            ["new", uuidKey],
            ["42", numericId],
            ["not-a-number", numericId],
            ["ABC-1", stringSku],
            ["1:::2", composite],
            ["1", composite],
            ["x:::2", composite]
        ];

        for (const [id, keys] of cases) {
            if (!isAddressableId(id, keys)) continue;
            expect(() => parseIdValues(id, keys)).not.toThrow();
        }
    });
});
