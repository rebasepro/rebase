/**
 * The address is derived on one side of the wire and parsed on the other, so
 * these two functions must invert each other exactly. A mismatch does not throw
 * — it addresses the wrong row.
 */
import { describe, expect, it } from "@jest/globals";
import {
    buildCompositeId,
    parseIdValues,
    getDeclaredPrimaryKeys,
    COMPOSITE_ID_SEPARATOR,
    PrimaryKeyInfo
} from "../src/util/identity";

const numericId: PrimaryKeyInfo[] = [{ fieldName: "id",
type: "number" }];
const stringSku: PrimaryKeyInfo[] = [{ fieldName: "sku",
type: "string" }];
const uuidKey: PrimaryKeyInfo[] = [{ fieldName: "id",
type: "string",
isUUID: true }];
const composite: PrimaryKeyInfo[] = [
    { fieldName: "tenant_id",
type: "number" },
    { fieldName: "user_id",
type: "number" }
];

describe("buildCompositeId", () => {

    it("derives a single key as a string", () => {
        expect(buildCompositeId({ id: 42,
name: "x" }, numericId)).toBe("42");
    });

    it("derives a composite key in primary-key order", () => {
        expect(buildCompositeId({ tenant_id: 1,
user_id: 2 }, composite)).toBe("1:::2");
    });

    it("returns empty string when the collection declares no keys", () => {
        expect(buildCompositeId({ id: 1 }, [])).toBe("");
    });

    it("does not invent a value for a missing key column", () => {
        expect(buildCompositeId({ name: "x" }, numericId)).toBe("");
    });

    it("writes a day key as YYYY-MM-DD, from the wire's string or the admin's Date", () => {
        const dayKey = getDeclaredPrimaryKeys({ properties: {
            day: { type: "date", columnType: "date", isId: "manual" },
            sid: { type: "string", isId: "manual" }
        } });
        expect(dayKey[0]).toMatchObject({ fieldName: "day", type: "string", isDay: true });
        expect(buildCompositeId({ day: "2026-11-09", sid: "a" }, dayKey)).toBe("2026-11-09:::a");
        expect(buildCompositeId({ day: new Date("2026-11-09"), sid: "a" }, dayKey)).toBe("2026-11-09:::a");
        expect(parseIdValues("2026-11-09:::a", dayKey)).toEqual({ day: "2026-11-09", sid: "a" });
    });
});

describe("parseIdValues", () => {

    it("restores a numeric key to a number, not a string", () => {
        // The driver puts this straight into a WHERE clause; a string here
        // either fails to match or forces a cast Postgres cannot index.
        expect(parseIdValues("42", numericId)).toEqual({ id: 42 });
        expect(parseIdValues(42, numericId)).toEqual({ id: 42 });
    });

    it("keeps a string key a string", () => {
        expect(parseIdValues("ABC-1", stringSku)).toEqual({ sku: "ABC-1" });
    });

    it("keeps a UUID a string even though it is not a number", () => {
        const uuid = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
        expect(parseIdValues(uuid, uuidKey)).toEqual({ id: uuid });
    });

    it("splits a composite address back into typed columns", () => {
        expect(parseIdValues("1:::2", composite)).toEqual({ tenant_id: 1,
user_id: 2 });
    });

    it("throws rather than address the wrong row on a malformed numeric id", () => {
        expect(() => parseIdValues("not-a-number", numericId)).toThrow(/Invalid numeric ID/);
    });

    it("throws on an id that only starts with a number, rather than address that number's row", () => {
        expect(() => parseIdValues("12abc", numericId)).toThrow(/Invalid numeric ID/);
        expect(() => parseIdValues("12.9", numericId)).toThrow(/Invalid numeric ID/);
        expect(() => parseIdValues("1e3", numericId)).toThrow(/Invalid numeric ID/);
        expect(() => parseIdValues("1:::2x", composite)).toThrow(/Invalid numeric ID component/);
        expect(parseIdValues("-7", numericId)).toEqual({ id: -7 });
    });

    it("keeps an integer a double cannot hold exactly as its digits", () => {
        // As a number, 9007199254740993 rounds to …992: another row.
        expect(parseIdValues("9007199254740993", numericId)).toEqual({ id: "9007199254740993" });
        expect(parseIdValues("9007199254740993:::1", composite))
            .toEqual({ tenant_id: "9007199254740993", user_id: 1 });
        expect(parseIdValues("9007199254740991", numericId)).toEqual({ id: 9007199254740991 });
    });

    it("passes a non-UUID through rather than judge a config's claim", () => {
        // `isUUID` here comes from `isId: "uuid"`, which is a declaration about
        // a key and not the column's type. Callers that want to refuse the
        // query ask `isAddressableId` (runtime/addressable-id) with column-derived key info.
        expect(parseIdValues("new", uuidKey)).toEqual({ id: "new" });
    });

    it("throws when a composite address has the wrong number of parts", () => {
        expect(() => parseIdValues("1", composite)).toThrow(/Composite ID parts mismatch/);
        expect(() => parseIdValues("1:::2:::3", composite)).toThrow(/Composite ID parts mismatch/);
    });

    it("returns nothing when the collection declares no keys", () => {
        expect(parseIdValues("1", [])).toEqual({});
    });
});

describe("round trip", () => {

    it("build → parse recovers the key columns", () => {
        const row = { tenant_id: 7,
user_id: 9,
name: "ignored" };
        expect(parseIdValues(buildCompositeId(row, composite), composite))
            .toEqual({ tenant_id: 7,
user_id: 9 });
    });

    it("is lossy when a string key contains the separator", () => {
        // Documents a real limitation rather than pretending it round-trips: a
        // value containing ":::" splits into the wrong number of parts. Single
        // keys are unaffected (no split), so this only bites composite keys
        // whose columns are free text.
        const twoStrings: PrimaryKeyInfo[] = [
            { fieldName: "a",
type: "string" },
            { fieldName: "b",
type: "string" }
        ];
        const built = buildCompositeId({ a: `x${COMPOSITE_ID_SEPARATOR}y`,
b: "z" }, twoStrings);
        expect(() => parseIdValues(built, twoStrings)).toThrow(/Composite ID parts mismatch/);
    });

    it("a single string key containing the separator survives", () => {
        const value = `x${COMPOSITE_ID_SEPARATOR}y`;
        expect(parseIdValues(buildCompositeId({ sku: value }, stringSku), stringSku))
            .toEqual({ sku: value });
    });
});

describe("getDeclaredPrimaryKeys", () => {

    it("reads keys declared with isId", () => {
        expect(getDeclaredPrimaryKeys({
            properties: {
                id: { type: "number",
isId: true },
                name: { type: "string" }
            }
        })).toEqual([{ fieldName: "id",
type: "number",
isUUID: false }]);
    });

    it("marks a uuid key as a string", () => {
        expect(getDeclaredPrimaryKeys({
            properties: { id: { type: "string",
isId: "uuid" } }
        })).toEqual([{ fieldName: "id",
type: "string",
isUUID: true }]);
    });

    it("reads composite keys in declaration order", () => {
        expect(getDeclaredPrimaryKeys({
            properties: {
                tenant_id: { type: "number",
isId: true },
                user_id: { type: "number",
isId: true }
            }
        }).map(k => k.fieldName)).toEqual(["tenant_id", "user_id"]);
    });

    it("returns none rather than guessing `id` when nothing is declared", () => {
        // A wrong guess produces confidently wrong addresses; callers must
        // treat an empty result as "not addressable".
        expect(getDeclaredPrimaryKeys({ properties: { name: { type: "string" } } })).toEqual([]);
        expect(getDeclaredPrimaryKeys({})).toEqual([]);
    });
});
