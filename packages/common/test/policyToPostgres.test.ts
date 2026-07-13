import { describe, it, expect } from "@jest/globals";
import { policyToPostgres } from "../src/util/policy/policyToPostgres";
import { evaluatePolicy } from "../src/util/policy/evaluatePolicy";
import { policy, CollectionConfig } from "@rebasepro/types";

const documents: CollectionConfig = {
    id: "documents",
    slug: "documents",
    name: "Documents",
    path: "documents",
    properties: { team_id: { dataType: "string", name: "Team" } }
} as unknown as CollectionConfig;

const teamMembers: CollectionConfig = {
    id: "team_members",
    slug: "team_members",
    name: "Team Members",
    path: "team_members",
    properties: {
        team_id: { dataType: "string", name: "Team" },
        user_id: { dataType: "string", name: "User" }
    }
} as unknown as CollectionConfig;

const resolveCollection = (slug: string) => [documents, teamMembers].find(c => c.slug === slug);

describe("policyToPostgres — existsIn (membership)", () => {
    it("compiles a correlated EXISTS subquery scoping reads to the caller's teams", () => {
        const expr = policy.existsIn({
            collection: "team_members",
            where: policy.and(
                policy.compare(policy.field("team_id"), "eq", policy.outerField("team_id")),
                policy.compare(policy.field("user_id"), "eq", policy.authUid())
            )
        });

        const sql = policyToPostgres(expr, documents, { resolveCollection });

        // Subquery over the join table, aliased.
        expect(sql).toContain(`EXISTS (SELECT 1 FROM "public"."team_members" "_ex0" WHERE`);
        // inner `field` binds to the aliased join table
        expect(sql).toContain(`"_ex0".team_id`);
        expect(sql).toContain(`"_ex0".user_id = auth.uid()`);
        // `outerField` binds to the outer RLS row, table-qualified
        expect(sql).toContain(`"public"."documents".team_id`);
    });

    it("falls back to a snake_cased table name when the collection can't be resolved", () => {
        const expr = policy.existsIn({
            collection: "teamMembers",
            where: policy.compare(policy.field("userId"), "eq", policy.authUid())
        });
        const sql = policyToPostgres(expr, documents);
        expect(sql).toContain(`FROM "public"."team_members" "_ex0"`);
        expect(sql).toContain(`"_ex0".user_id = auth.uid()`);
    });

    it("does not regress non-existsIn compilation (bare columns at top level)", () => {
        const expr = policy.compare(policy.field("team_id"), "eq", policy.authUid());
        expect(policyToPostgres(expr, documents)).toBe("team_id = auth.uid()");
    });

    it("is treated as server-authoritative (unknown) by the JS evaluator", () => {
        const expr = policy.existsIn({
            collection: "team_members",
            where: policy.compare(policy.field("user_id"), "eq", policy.authUid())
        });
        expect(evaluatePolicy(expr, { uid: "u1", roles: [] })).toBe("unknown");
    });
});
