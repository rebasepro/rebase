/**
 * The remediation for a policy Rebase owns.
 *
 * `ensureCollectionPolicies` drops and recreates every generated policy on each
 * boot, so the tool's usual advice — edit the policy — is not merely unhelpful
 * on a Rebase deployment, it is wrong in a way that looks right: the operator
 * runs the SQL, the finding disappears, and the next restart puts the hole back.
 * These tests pin the two halves that keep that from happening: what counts as a
 * policy Rebase owns, and that the fix for one names the rule instead of SQL.
 */
import { describe, expect, it } from "vitest";

import { policy, snapshot, table } from "../../test/fixtures/snapshot";
import { anonymousWriteAllowed } from "./anonymous-write-allowed";
import { policyAlwaysTrue } from "./policy-always-true";
import { policyAuthenticatedTautology } from "./policy-authenticated-tautology";
import { isRebaseManagedPolicy } from "./util";

/** A Rebase deployment: `rebase_user` is the role requests arrive as. */
const rebaseDb = (policies: ReturnType<typeof policy>[], relations = [table("public", "posts")]) =>
    snapshot({
        platform: "rebase",
        exposedRoles: ["PUBLIC", "rebase_user"],
        relations,
        policies
    });

describe("isRebaseManagedPolicy", () => {
    it("recognises a generated <table>_<op>_<hash> name", () => {
        const snap = rebaseDb([policy("public", "posts", "posts_select_841c287", { using: "true" })]);
        expect(isRebaseManagedPolicy(snap, snap.policies[0])).toBe(true);
    });

    it("recognises an indexed multi-operation name", () => {
        const snap = rebaseDb([
            policy("public", "posts", "posts_insert_3561e70_0", { command: "INSERT", withCheck: "true" })
        ]);
        expect(isRebaseManagedPolicy(snap, snap.policies[0])).toBe(true);
    });

    it("recognises a hand-named policy by its call to a rebase helper", () => {
        // The `<table>_default_admin_read` policies boot writes carry no hash.
        const snap = rebaseDb([
            policy("public", "posts", "posts_default_admin_read", {
                using: "((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]))"
            })
        ]);
        expect(isRebaseManagedPolicy(snap, snap.policies[0])).toBe(true);
    });

    it("does not claim a policy whose name belongs to another table", () => {
        const snap = rebaseDb([policy("public", "posts", "orders_select_841c287", { using: "true" })]);
        expect(isRebaseManagedPolicy(snap, snap.policies[0])).toBe(false);
    });

    it("does not claim a hand-written policy on a Rebase database", () => {
        const snap = rebaseDb([policy("public", "posts", "posts_are_public", { using: "true" })]);
        expect(isRebaseManagedPolicy(snap, snap.policies[0])).toBe(false);
    });

    it("does not claim a lookalike name on a database Rebase did not create", () => {
        const snap = snapshot({
            relations: [table("public", "posts")],
            policies: [policy("public", "posts", "posts_select_841c287", { using: "true" })]
        });
        expect(snap.platform).toBe("unknown");
        expect(isRebaseManagedPolicy(snap, snap.policies[0])).toBe(false);
    });
});

describe("the fix for a Rebase-managed policy", () => {
    const managedFix = (): string => {
        const [f] = policyAlwaysTrue.run(
            rebaseDb([policy("public", "posts", "posts_select_841c287", { using: "true" })])
        );
        return f.fix ?? "";
    };

    it("names the rule the policy is compiled from", () => {
        expect(managedFix()).toContain("securityRules");
        expect(managedFix()).toContain("config/collections/");
    });

    it("says the database edit is undone at the next boot", () => {
        expect(managedFix()).toContain("re-applies it");
        expect(managedFix()).toMatch(/undone the next time the runtime\s*\n?starts/);
    });

    it("prescribes no SQL against the policy, because boot would revert it", () => {
        expect(managedFix()).not.toContain("ALTER POLICY");
        expect(managedFix()).not.toContain("DROP POLICY");
    });

    it("points at the security-rules page, not only the check's own anchor", () => {
        expect(managedFix()).toContain("https://rebase.pro/docs/collections/security-rules");
    });

    it("mentions the inherited defaults, which is where a scaffold's open read lives", () => {
        expect(managedFix()).toContain("defaultSecurityRules");
    });

    it("leaves the SQL remediation in place for a hand-written policy", () => {
        const [f] = policyAlwaysTrue.run(
            rebaseDb([policy("public", "posts", "posts_are_public", { using: "true" })])
        );
        expect(f.fix).toContain('ALTER POLICY "posts_are_public" ON "public"."posts"');
    });
});

describe("the sibling checks that prescribe ALTER POLICY", () => {
    it("policy-authenticated-tautology defers to the rule", () => {
        const [f] = policyAuthenticatedTautology.run(
            rebaseDb([
                policy("public", "posts", "posts_select_841c287", {
                    using: "((rebase.uid() IS NOT NULL) AND (rebase.uid() <> 'anonymous'::text))"
                })
            ])
        );
        expect(f?.fix).toContain("securityRules");
        expect(f?.fix).not.toContain("ALTER POLICY");
    });

    it("anonymous-write-allowed defers to the rule", () => {
        const snap = rebaseDb([
            policy("public", "posts", "posts_insert_3561e70_0", { command: "INSERT", withCheck: "true" })
        ]);
        snap.grants = [{ schema: "public", table: "posts", grantee: "rebase_user", privileges: ["INSERT"] }];
        snap.exposedRoles = ["PUBLIC", "anon"];
        snap.grants.push({ schema: "public", table: "posts", grantee: "anon", privileges: ["INSERT"] });

        const [f] = anonymousWriteAllowed.run(snap);
        expect(f?.fix).toContain("securityRules");
        expect(f?.fix).not.toContain("ALTER POLICY");
    });
});
