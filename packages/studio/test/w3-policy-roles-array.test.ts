import { describe, expect, it } from "@jest/globals";
import { readPolicyRoles } from "../src/components/RLSEditor/policyListing";

/**
 * `pg_policies.roles` is a `name[]`, which a driver may hand back as
 * Postgres's text for an array. An element is quoted there when it holds a
 * comma, a brace, a quote, a backslash or a space, so splitting the text on
 * commas read `{"my role",anon}` as the role `"my role"` — quotes and all —
 * and an edit of the policy then named a role that does not exist.
 */
describe("readPolicyRoles", () => {
    it("reads plain elements", () => {
        expect(readPolicyRoles("{public}")).toEqual(["public"]);
        expect(readPolicyRoles("{anon,authenticated}")).toEqual(["anon", "authenticated"]);
    });

    it("reads a quoted element without its quotes", () => {
        expect(readPolicyRoles("{\"my role\",anon}")).toEqual(["my role", "anon"]);
    });

    it("keeps a comma, a quote and a backslash inside a quoted element", () => {
        expect(readPolicyRoles("{\"a,b\",\"say \\\"hi\\\"\",\"back\\\\slash\"}"))
            .toEqual(["a,b", "say \"hi\"", "back\\slash"]);
    });

    it("reads an empty array as no roles", () => {
        expect(readPolicyRoles("{}")).toEqual([]);
    });

    it("takes an array as it comes, and anything else as no roles", () => {
        expect(readPolicyRoles(["anon", "my role"])).toEqual(["anon", "my role"]);
        expect(readPolicyRoles(null)).toEqual([]);
        expect(readPolicyRoles(undefined)).toEqual([]);
    });
});
