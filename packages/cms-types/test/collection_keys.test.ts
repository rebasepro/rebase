import { getDeclaredPrimaryKeys } from "../src/util/collection_keys";

describe("getDeclaredPrimaryKeys: a day key", () => {
    it("marks a `date` key as a day key", () => {
        const dayKey = getDeclaredPrimaryKeys({ properties: {
            day: { type: "date", columnType: "date", isId: "manual" },
            sid: { type: "string", isId: "manual" }
        } });
        expect(dayKey[0]).toMatchObject({ fieldName: "day", type: "string", isDay: true });
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
