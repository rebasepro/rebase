import { describe, expect, it } from "@jest/globals";
import { col, defineTable } from "@rebasepro/types";
import type { SecurityRule } from "@rebasepro/types";
import { getPolicyNamesForRule } from "@rebasepro/utils";
import { applyPolicyEdit, ruleForm } from "../src/components/RLSEditor/policyRules";
import { declaredPoliciesOf, listPolicies, type ListedPolicy } from "../src/components/RLSEditor/policyListing";
import { servedTables } from "./helpers/servedTables";

/**
 * The RLS editor over the rule forms added with the Postgres-first `rls` — a
 * `PolicyShorthand` condition / check, `access` with a condition / check, bare
 * `access: "authenticated"` — and the `redacted` marker the server sends in
 * place of a rule whose SQL it withheld.
 *
 * The editor shows each rule as the policy the server compiles it to and writes back only
 * the fields the form changed, so a rule nobody edited is saved exactly as
 * written: rewritten into another shape, its policy would be renamed.
 */

/** `posts` declaring the one rule, as the server serves it to an administrator. */
function postsWith(rule: SecurityRule) {
    const [posts] = servedTables([defineTable("posts", {
        columns: { id: col.uuid().primaryKey().defaultRandom(), status: col.text(), orgId: col.text("org_id") },
        rls: [rule]
    })]);
    return posts;
}

const NEW_SHAPES: SecurityRule[] = [
    { operation: "select", access: "public", condition: { status: "published" } },
    { operation: "update", access: "authenticated", condition: { status: "draft" }, check: { orgId: "acme" } },
    { operation: "insert", access: "authenticated", check: { status: "draft" } },
    { operation: "select", access: "authenticated" },
    { operation: "select", condition: { orgId: "acme" } }
];

/** The policy the editor is opened with for `rule`: what the server compiles it to. */
function shown(rule: SecurityRule): ListedPolicy {
    const listed = listPolicies([], declaredPoliciesOf(postsWith(rule).rls), "posts");
    const [name] = getPolicyNamesForRule(rule, "posts");
    const policy = listed.find(p => p.policyname === name);
    if (!policy) throw new Error(`not listed: ${name}`);
    return policy;
}

describe("the RLS editor on the new rule forms", () => {
    it("classifies every form, and only a redacted rule as not editable", () => {
        expect(NEW_SHAPES.map(ruleForm)).toEqual(["conditional_access", "conditional_access", "conditional_access", "access", "structured"]);
        expect(ruleForm({ operation: "update", roles: ["editor"], redacted: true })).toBe("redacted");
    });

    it("lists a shorthand as the equality it means, and the signed-in test for `authenticated`", () => {
        expect(shown(NEW_SHAPES[0]).qual).toBe("status = 'published'");
        expect(shown(NEW_SHAPES[1]).with_check).toContain("org_id = 'acme'");
        expect(shown(NEW_SHAPES[3]).qual).toBe("(SELECT rebase.uid()) IS NOT NULL AND (SELECT rebase.uid()) NOT IN ('anonymous', 'anon')");
    });

    it("saves an untouched rule exactly as written", () => {
        for (const rule of NEW_SHAPES) {
            const original = shown(rule);
            const result = applyPolicyEdit([rule], original, { ...original });
            expect(result).toEqual({ ok: true, rules: [rule] });
        }
    });

    it("keeps the shape when only the name changes", () => {
        const rule = NEW_SHAPES[0];
        const original = shown(rule);
        const result = applyPolicyEdit([rule], original, { ...original, policyname: "published_read" });
        expect(result).toEqual({
            ok: true,
            rules: [{ name: "published_read", operation: "select", access: "public", condition: { status: "published" } }]
        });
    });

    it("refuses to edit a redacted rule — it is defined on the server", () => {
        const rule: SecurityRule = { name: "editors_update", operation: "update", roles: ["editor"], redacted: true };
        const original: ListedPolicy = {
            policyname: "editors_update", tablename: "posts", permissive: "PERMISSIVE", cmd: "UPDATE",
            roles: ["public"], qual: null, with_check: null, status: "code_only", rule: 0
        };
        expect(applyPolicyEdit([rule], original, { ...original, qual: "true" }))
            .toEqual({ ok: false, reason: "redacted" });
    });
});
