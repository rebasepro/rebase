import { describe, expect, it } from "vitest";

import { policy, reachable, snapshot, table } from "../../test/fixtures/snapshot";
import type { DbSnapshot } from "../types";
import { policyAuthenticatedTautology as authenticated } from "./policy-authenticated-tautology";
import { policyAnonymousTautology as anonymous } from "./policy-anonymous-tautology";

// These tests are about the policy's shape; `reachable` grants every table to
// the exposed roles, because a policy on a table nobody can reach is not reported.
const policyAuthenticatedTautology = { run: (s: DbSnapshot) => authenticated.run(reachable(s)) };
const policyAnonymousTautology = { run: (s: DbSnapshot) => anonymous.run(reachable(s)) };

const withPolicy = (using: string | null) =>
    snapshot({
        platform: "rebase",
        relations: [table("public", "users")],
        policies: [policy("public", "users", "users_read", { using, roles: ["authenticated"] })]
    });

/**
 * The corrected anonymous tautology, which corrects the wrong half.
 *
 * Adding `<> 'anonymous'` really does exclude signed-out callers, and the
 * scanner treated it as a clean bill of health. What it does not do is scope
 * rows — the policy still says "every registered account may read every row",
 * which is how a customer's `users` table became readable by anyone who could
 * sign up.
 */
describe("policy-authenticated-tautology", () => {
    it("flags the sentinel-guarded caller-id test", () => {
        const findings = policyAuthenticatedTautology.run(
            withPolicy("((auth.uid() IS NOT NULL) AND (auth.uid() <> 'anonymous'::text))")
        );

        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("high");
        expect(findings[0].impact).toContain("every row");
    });

    it("reads `auth.role() <> 'anon'` as the role guard it is", () => {
        // A signed-out Supabase request arrives as the role 'anon', so excluding
        // it does exclude signed-out callers — and leaves every account reading
        // every row, which is this finding.
        const findings = policyAuthenticatedTautology.run(
            snapshot({
                platform: "supabase",
                relations: [table("public", "users")],
                policies: [
                    policy("public", "users", "users_read", {
                        using: "((auth.role() IS NOT NULL) AND (auth.role() <> 'anon'::text))",
                        roles: ["authenticated"]
                    })
                ]
            })
        );

        expect(findings).toHaveLength(1);
        expect(findings[0].detail).toContain("auth.role()");
        expect(findings[0].detail).toContain("is not the anonymous");
    });

    it("recognises the reversed order", () => {
        expect(policyAuthenticatedTautology.run(
            withPolicy("(auth.uid() <> 'anonymous' AND auth.uid() IS NOT NULL)")
        )).toHaveLength(1);
    });

    /**
     * `'anon'` is a decoy, not a guard — which makes it the *worse* finding.
     *
     * This case asserted the opposite when it was written, on the reasonable
     * assumption that any `<>` against an anonymous-looking literal excludes
     * signed-out callers. It does not. `'anon'` is the id the request path
     * reported before the sentinel was unified, so on every server shipping
     * today a policy excluding only `'anon'` excludes nobody: the null test
     * stands on its own and signed-out callers read every row. That is the
     * anonymous tautology at `critical`, not the authenticated one at `high`.
     *
     * Reporting it here would understate a policy open to the internet as one
     * merely open to every account, so the clearing list stays narrow and this
     * check stays quiet.
     */
    it("treats 'anon' as a decoy and leaves it to the anonymous check", () => {
        const decoyGuarded = withPolicy("(auth.uid() IS NOT NULL AND auth.uid() <> 'anon')");

        expect(policyAuthenticatedTautology.run(decoyGuarded)).toEqual([]);

        const anonymous = policyAnonymousTautology.run(decoyGuarded);
        expect(anonymous).toHaveLength(1);
        expect(anonymous[0].severity).toBe("critical");
        expect(anonymous[0].title).toContain("'anon'");
    });

    it("recognises the empty-string sentinel", () => {
        expect(policyAuthenticatedTautology.run(
            withPolicy("((auth.uid() IS NOT NULL) AND (auth.uid() <> ''))")
        )).toHaveLength(1);
    });

    /** The whole point of the "entire expression" rule: a scoped policy is fine. */
    it("says nothing about a policy that scopes rows to their owner", () => {
        expect(policyAuthenticatedTautology.run(
            withPolicy("((auth.uid() IS NOT NULL) AND (auth.uid() <> 'anonymous') AND (user_id = auth.uid()))")
        )).toEqual([]);

        expect(policyAuthenticatedTautology.run(
            withPolicy("(user_id = auth.uid())")
        )).toEqual([]);
    });

    it("leaves the bare form to the anonymous check", () => {
        expect(policyAuthenticatedTautology.run(withPolicy("(auth.uid() IS NOT NULL)"))).toEqual([]);
    });

    /**
     * The two checks partition the space rather than overlapping: the guarded
     * form is one finding, the bare form is the other, and never both. Two
     * findings for one policy would make the fix ambiguous.
     */
    it("does not double-report with the anonymous check", () => {
        const guarded = withPolicy("(auth.uid() IS NOT NULL AND auth.uid() <> 'anonymous')");
        expect(policyAnonymousTautology.run(guarded)).toEqual([]);
        expect(policyAuthenticatedTautology.run(guarded)).toHaveLength(1);

        const bare = withPolicy("(auth.uid() IS NOT NULL)");
        expect(policyAnonymousTautology.run(bare)).toHaveLength(1);
        expect(policyAuthenticatedTautology.run(bare)).toEqual([]);
    });
});
