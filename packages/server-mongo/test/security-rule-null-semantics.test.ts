/**
 * A security rule compared against NULL, translated to a MongoDB filter.
 *
 * SQL answers NULL for every comparison against NULL, and NULL grants nothing,
 * so Postgres hides a row whose column is NULL from `visibility != 'private'`.
 * MongoDB answers the same comparison: `$ne` matches a document whose field is
 * null or missing, `{ f: { $eq: null } }` matches every document without `f`,
 * and an aggregation `$lt` ranks null below every value. The translation used
 * the operators as they were, so the Mongo driver listed rows the same rule
 * hides on Postgres.
 */

import { policy, type CollectionConfig, type User } from "@rebasepro/types";
import { buildMongoFilterFromSecurityRules, policyToMongoFilter } from "../src/db/securityRuleFilter";

const reader: User = {
    uid: "u1",
    roles: ["editor"],
    displayName: null,
    email: null,
    photoURL: null,
    providerId: "test",
    isAnonymous: false
};

describe("Mongo security-rule translation of comparisons against NULL", () => {
    it("does not grant a document whose field is null or missing through `<>`", () => {
        const filter = policyToMongoFilter(
            policy.compare(policy.field("visibility"), "neq", policy.literal("private")),
            reader
        );
        expect(filter).toEqual({ visibility: { $ne: "private", $nin: [null] } });
    });

    it("grants nothing on a comparison with a NULL literal, and refuses to negate it", () => {
        const isNull = policy.compare(policy.field("deleted_at"), "eq", policy.literal(null));
        expect(policyToMongoFilter(isNull, reader)).toEqual({ _id: { $exists: false } });
        // `NOT (x = NULL)` is still NULL, never "every row".
        expect(policyToMongoFilter(policy.not(isNull), reader)).toBe("untranslatable");
    });

    it("requires both fields to hold a value for a field-to-field comparison", () => {
        const filter = policyToMongoFilter(
            policy.compare(policy.field("reviewer_id"), "neq", policy.field("author_id")),
            reader
        );
        expect(filter).toEqual({
            $and: [
                { reviewer_id: { $ne: null } },
                { author_id: { $ne: null } },
                { $expr: { $ne: ["$reviewer_id", "$author_id"] } }
            ]
        });
    });

    it("narrows a listing by the NULL-aware filter", () => {
        const posts: CollectionConfig = {
            slug: "posts",
            name: "Posts",
            engine: "mongodb",
            properties: { visibility: { name: "Visibility", type: "string" } },
            securityRules: [{
                operation: "select",
                condition: policy.compare(policy.field("visibility"), "neq", policy.literal("private"))
            }]
        };
        expect(buildMongoFilterFromSecurityRules(posts, reader, "select"))
            .toEqual({ visibility: { $ne: "private", $nin: [null] } });
    });

    it("keeps the comparisons that already exclude null as they were", () => {
        expect(policyToMongoFilter(policy.compare(policy.field("owner"), "eq", policy.authUid()), reader))
            .toEqual({ owner: { $eq: "u1" } });
        expect(policyToMongoFilter(policy.compare(policy.literal(5), "lt", policy.field("level")), reader))
            .toEqual({ level: { $gt: 5 } });
    });
});
