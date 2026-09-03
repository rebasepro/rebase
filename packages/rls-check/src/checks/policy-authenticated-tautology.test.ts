import { describe, expect, it } from "vitest";

import { policy, snapshot, table } from "../../test/fixtures/snapshot";
import { policyAuthenticatedTautology } from "./policy-authenticated-tautology";
import { policyAnonymousTautology } from "./policy-anonymous-tautology";

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

    it("recognises the reversed order", () => {
        expect(policyAuthenticatedTautology.run(
            withPolicy("(auth.uid() <> 'anonymous' AND auth.uid() IS NOT NULL)")
        )).toHaveLength(1);
    });

    /**
     * `'anon'` is NOT this check's case, and used to be asserted here as if it
     * were.
     *
     * A guard only belongs to this finding if it excludes an id a signed-out
     * caller can actually arrive with. `'anon'` is the id the request path
     * reported before the sentinel was unified on `'anonymous'`, so a policy
     * excluding only `'anon'` excludes nobody on any server shipping today — it
     * is still wide open to anonymous callers, not merely to signed-in ones.
     *
     * So it stays with {@link policyAnonymousTautology}, which is `critical`
     * rather than this check's `high`, and which names the decoy in its title.
     * Routing it here would have quietly downgraded the severity of the exact
     * predicate that leaked a production `users` table.
     */
    it("leaves `<> 'anon'` to the anonymous check, which rates it higher", () => {
        expect(policyAuthenticatedTautology.run(
            withPolicy("(auth.uid() IS NOT NULL AND auth.uid() <> 'anon')")
        )).toEqual([]);
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
