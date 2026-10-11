/**
 * `pg_policies.roles` is `name[]`. It was read by splitting its text on
 * commas, so a policy `TO "web readers, all"` named two roles that do not
 * exist: a false `policy-role-unreachable`, and a missed `policy-always-true`
 * for the role it does name.
 */
import { describe, expect, it } from "vitest";

import { parsePgTextArray, readPolicies, type Reader } from "./introspect";

describe("parsePgTextArray", () => {
    it.each([
        ["{anon,authenticated}", ["anon", "authenticated"]],
        ["{\"web readers, all\"}", ["web readers, all"]],
        ["{anon,\"web readers, all\",public}", ["anon", "web readers, all", "public"]],
        ["{\"a \\\"quoted\\\" role\"}", ["a \"quoted\" role"]],
        ["{\"back\\\\slash\"}", ["back\\slash"]],
        ["{}", []]
    ])("reads %s", (literal, roles) => {
        expect(parsePgTextArray(literal)).toEqual(roles);
    });
});

describe("readPolicies", () => {
    it("reads a role whose name holds a comma as one role, and asks for text[]", async () => {
        let sql = "";
        const reader: Reader = {
            async query<R extends Record<string, unknown>>(what: string, text: string): Promise<R[]> {
                if (what !== "policies") return [];
                sql = text;
                return [{
                    schemaname: "public", tablename: "t", policyname: "p", permissive: "PERMISSIVE",
                    roles: "{\"web readers, all\"}", cmd: "SELECT", qual: "true", with_check: null
                }] as unknown as R[];
            }
        };
        const [policy] = await readPolicies(reader, ["public"]);
        expect(policy.roles).toEqual(["web readers, all"]);
        expect(sql).toContain("roles::text[]");
    });
});
