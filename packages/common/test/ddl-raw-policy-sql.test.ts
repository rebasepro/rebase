import { describe, it, expect } from "@jest/globals";
import { CollectionConfig, SecurityRule, policy } from "@rebasepro/types";
import { compileRulePolicies } from "./helpers/legacy-policies";
import { policyToPostgres } from "./helpers/legacy-policies";
import { sqlToPolicy } from "../src/util/policy/sqlToPolicy";

const orgs: CollectionConfig = {
    slug: "orgs",
    table: "orgs",
    name: "Orgs",
    properties: { org_id: { type: "number" }, owner_id: { type: "string" } }
};

const compileUsing = (rule: SecurityRule): string => compileRulePolicies(orgs, rule)[0].using as string;

describe("a raw clause's numeric literal", () => {
    it("keeps every digit of an id wider than a JS number holds", () => {
        const using = compileUsing({ operation: "select", using: "org_id = 1234567890123456789" });
        expect(using).toContain("1234567890123456789");
        expect(using).not.toContain("1234567890123456800");
    });

    it("keeps a decimal with more places than a JS number holds", () => {
        expect(policyToPostgres(sqlToPolicy("score = 0.12345678901234567891"), orgs))
            .toContain("0.12345678901234567891");
    });

    it("still reads a number a JS number holds exactly as a literal", () => {
        expect(sqlToPolicy("org_id = 9007199254740991")).toEqual({
            kind: "compare", op: "eq",
            left: { kind: "field", name: "org_id" },
            right: { kind: "literal", value: 9007199254740991 }
        });
        expect(sqlToPolicy("score != -0.50")).toMatchObject({ right: { kind: "literal", value: -0.5 } });
    });
});

describe("a raw clause ending in a line comment", () => {
    /** Text the clause leaves a line comment open over, which Postgres reads as comment. */
    const commentedOut = (sql: string): string[] =>
        [...sql.matchAll(/--[^\n]*/g)].map(m => m[0]);

    it("closes the comment before the clause's own closing paren", () => {
        const using = compileUsing({ operation: "select", using: "owner_id = rebase.uid() -- the owner only" });
        const statement = `CREATE POLICY p ON orgs USING (${using}) WITH CHECK (true)`;
        expect(commentedOut(statement)).toEqual(["-- the owner only"]);
    });

    it("closes it before the next operand of a split AND / OR", () => {
        const using = compileUsing({
            operation: "select",
            using: "owner_id = rebase.uid() -- the owner\nOR org_id = 7"
        });
        expect(using).toMatch(/OR \(org_id = 7\)$/);
        expect(commentedOut(using)).toEqual(["-- the owner"]);
    });

    it("leaves a comment a newline already closes as written", () => {
        expect(policyToPostgres(policy.raw("owner_id -- a\n IS NULL"), orgs)).toBe("owner_id -- a\n IS NULL");
    });
});

describe("an empty role list", () => {
    it("compiles to a typed empty array, which Postgres accepts", () => {
        expect(policyToPostgres(policy.rolesOverlap([]))).toBe(
            "(SELECT string_to_array(rebase.roles(), ',') && ARRAY[]::text[])"
        );
        expect(policyToPostgres(policy.rolesContain([]))).toContain("@> ARRAY[]::text[]");
    });
});
