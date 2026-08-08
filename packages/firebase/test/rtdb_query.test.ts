import { describe, expect, it } from "@jest/globals";
import { planRTDBQuery } from "../src/hooks/useFirebaseRealTimeDBDelegate";

describe("planRTDBQuery", () => {

    it("applies an equality filter", () => {
        // The whole point: this used to be dropped, and the read answered with
        // the entire collection.
        expect(planRTDBQuery({ filter: { status: ["==", "draft"] } })).toEqual({
            orderByChild: "status",
            equalTo: "draft"
        });
    });

    it("applies a range on a single key", () => {
        expect(planRTDBQuery({ filter: { age: [[">=", 18], ["<=", 65]] } })).toEqual({
            orderByChild: "age",
            startAt: 18,
            endAt: 65
        });
    });

    it("applies orderBy on its own", () => {
        expect(planRTDBQuery({
            orderBy: "created_on",
            order: "asc",
            limit: 10
        })).toEqual({
            orderByChild: "created_on",
            limitToFirst: 10
        });
    });

    it("pages by key, exclusive of the cursor", () => {
        expect(planRTDBQuery({
            startAfter: "row-3",
            limit: 10
        })).toEqual({
            startAfter: "row-3",
            limitToFirst: 10
        });
    });

    it("reads past the offset", () => {
        // No constraint expresses an offset, so the window has to be widened
        // and the front dropped by the caller. Dropping the offset instead
        // served page one to every page.
        expect(planRTDBQuery({
            limit: 50,
            offset: 100
        })).toEqual({
            limitToFirst: 150,
            skip: 100
        });
    });

    it("leaves an unpaged read alone", () => {
        expect(planRTDBQuery({
            limit: 50,
            offset: 0
        })).toEqual({ limitToFirst: 50 });
    });

    it("refuses an operator the database cannot evaluate", () => {
        expect(() => planRTDBQuery({ filter: { status: ["!=", "draft"] } }))
            .toThrow(/does not support the "!=" operator/);
    });

    it("refuses a second filtered field", () => {
        expect(() => planRTDBQuery({
            filter: {
                status: ["==", "draft"],
                author: ["==", "me"]
            }
        })).toThrow(/one child key per query/);
    });

    it("refuses a filter and an unrelated orderBy", () => {
        expect(() => planRTDBQuery({
            filter: { status: ["==", "draft"] },
            orderBy: "created_on"
        })).toThrow(/ordered by the key it filters on/);
    });

    it("refuses a descending order", () => {
        expect(() => planRTDBQuery({
            orderBy: "created_on",
            order: "desc"
        })).toThrow(/only orders ascending/);
    });

    it("refuses a text search", () => {
        expect(() => planRTDBQuery({ searchString: "draft" }))
            .toThrow(/no text search/);
    });

    it("refuses a logical group", () => {
        expect(() => planRTDBQuery({
            logical: {
                type: "or",
                conditions: [{
                    column: "status",
                    operator: "==",
                    value: "draft"
                }]
            }
        })).toThrow(/or\(\.\.\.\)/);
    });

    it("refuses a value the database cannot compare", () => {
        expect(() => planRTDBQuery({ filter: { tags: ["==", ["a", "b"]] } }))
            .toThrow(/cannot bound `tags` by a array value/);
    });

    it("refuses a cursor combined with a filter", () => {
        expect(() => planRTDBQuery({
            filter: { status: ["==", "draft"] },
            startAfter: "row-3"
        })).toThrow(/pages in key order/);
    });

    it("plans nothing for an unqualified read", () => {
        expect(planRTDBQuery({})).toEqual({});
    });

});
