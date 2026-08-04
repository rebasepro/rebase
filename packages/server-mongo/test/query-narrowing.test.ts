import { MongoConditionBuilder } from "../src/db/MongoConditionBuilder";
import type { LogicalCondition } from "@rebasepro/types";

/**
 * The narrowing a query asks for, against the Mongo driver.
 *
 * `FetchCollectionProps` declares `logical` and `offset`; this driver
 * destructured neither, and `MongoDataService` had no parameter for either. So
 * both were accepted at every type-checked boundary above and then discarded —
 * `where(or(…))` came back as the whole collection, and `?offset=20` served
 * page one. A dropped filter does not fail, it widens, which is why nothing
 * ever surfaced it.
 */

const DRAFT_OR_REVIEW: LogicalCondition = {
    type: "or",
    conditions: [
        { column: "status", operator: "==", value: "draft" },
        { column: "status", operator: "==", value: "review" }
    ]
};

describe("MongoConditionBuilder logical groups", () => {
    it("translates an or() group to $or", () => {
        const query = MongoConditionBuilder.buildQuery({ logical: DRAFT_OR_REVIEW });

        expect(query).toEqual({
            $or: [{ status: { $eq: "draft" } }, { status: { $eq: "review" } }]
        });
    });

    it("translates an and() group to $and", () => {
        const query = MongoConditionBuilder.buildQuery({
            logical: {
                type: "and",
                conditions: [
                    { column: "views", operator: ">=", value: 10 },
                    { column: "status", operator: "==", value: "draft" }
                ]
            }
        });

        expect(query).toEqual({
            $and: [{ views: { $gte: 10 } }, { status: { $eq: "draft" } }]
        });
    });

    it("nests groups inside groups", () => {
        const query = MongoConditionBuilder.buildQuery({
            logical: {
                type: "and",
                conditions: [
                    { column: "published", operator: "==", value: true },
                    DRAFT_OR_REVIEW
                ]
            }
        }) as Record<string, unknown>;

        expect(query.$and).toEqual([
            { published: { $eq: true } },
            { $or: [{ status: { $eq: "draft" } }, { status: { $eq: "review" } }] }
        ]);
    });

    it("ANDs a logical group with `filter`, as the contract states", () => {
        // `where`, `logical` and `searchString` are independent and stack.
        const query = MongoConditionBuilder.buildQuery({
            filter: { author: ["==", "u1"] },
            logical: DRAFT_OR_REVIEW
        }) as Record<string, unknown>;

        expect(query.$and).toEqual([
            { author: { $eq: "u1" } },
            { $or: [{ status: { $eq: "draft" } }, { status: { $eq: "review" } }] }
        ]);
    });

    it("uses the same operator translation as a plain filter", () => {
        // The group must not become a second dialect: an operator means the
        // same thing whichever side of the query it is written on.
        const viaFilter = MongoConditionBuilder.buildQuery({ filter: { tags: ["array-contains", "x"] } });
        const viaLogical = MongoConditionBuilder.buildQuery({
            logical: { type: "and", conditions: [{ column: "tags", operator: "array-contains", value: "x" }] }
        });

        expect(viaLogical).toEqual(viaFilter);
    });

    it("drops an empty group rather than matching nothing", () => {
        // `$or: []` is a Mongo error, and `$and: []` matches everything by
        // accident. Neither is a defensible answer to "no conditions".
        expect(MongoConditionBuilder.buildQuery({ logical: { type: "or", conditions: [] } })).toEqual({});
    });
});
