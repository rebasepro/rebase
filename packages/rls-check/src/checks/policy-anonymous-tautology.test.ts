import { describe, expect, it } from "vitest";

import { policy, snapshot, table } from "../../test/fixtures/snapshot";
import { policyAnonymousTautology } from "./policy-anonymous-tautology";

const withPolicy = (using: string | null, platform: ReturnType<typeof snapshot>["platform"] = "unknown") =>
    snapshot({
        platform,
        relations: [table("public", "orders")],
        policies: [policy("public", "orders", "orders_read", { using, roles: ["authenticated"] })]
    });

describe("policy-anonymous-tautology", () => {
    it("flags `auth.uid() IS NOT NULL`", () => {
        const findings = policyAnonymousTautology.run(withPolicy("(auth.uid() IS NOT NULL)"));

        expect(findings).toHaveLength(1);
        expect(findings[0].confidence).toBe("heuristic");
        expect(findings[0].title).toContain("auth.uid()");
    });

    it("recognises the Postgres-rendered `( SELECT auth.uid() AS uid) IS NOT NULL`", () => {
        expect(
            policyAnonymousTautology.run(withPolicy("(( SELECT auth.uid() AS uid) IS NOT NULL)"))
        ).toHaveLength(1);
    });

    it("recognises current_setting(...) IS NOT NULL", () => {
        const [f] = policyAnonymousTautology.run(
            withPolicy("(current_setting('request.jwt.claim.sub', true) IS NOT NULL)")
        );

        expect(f.title).toContain("current_setting('request.jwt.claim.sub')");
    });

    describe("severity depends on how the stack treats a signed-out caller", () => {
        it("is only `low` on Supabase, where auth.uid() is NULL when anonymous", () => {
            const [f] = policyAnonymousTautology.run(
                withPolicy("(auth.uid() IS NOT NULL)", "supabase")
            );

            expect(f.severity).toBe("low");
            expect(f.detail).toContain("returns NULL for an anonymous request");
            expect(f.impact).toContain("not an anonymous-access hole");
        });

        it("is `critical` on Rebase, where a signed-out caller gets a sentinel id", () => {
            const [f] = policyAnonymousTautology.run(withPolicy("(auth.uid() IS NOT NULL)", "rebase"));

            expect(f.severity).toBe("critical");
            expect(f.detail).toContain("sentinel id");
        });

        it("is `critical` on PostgREST for the same reason", () => {
            const [f] = policyAnonymousTautology.run(
                withPolicy("(auth.uid() IS NOT NULL)", "postgrest")
            );

            expect(f.severity).toBe("critical");
        });

        it("is `medium` on an unknown platform, and says the answer depends on the stack", () => {
            const [f] = policyAnonymousTautology.run(withPolicy("(auth.uid() IS NOT NULL)", "unknown"));

            expect(f.severity).toBe("medium");
            expect(f.impact).toContain("depends on whether your stack coerces");
        });
    });

    it("does NOT flag a policy that also scopes the row", () => {
        expect(
            policyAnonymousTautology.run(
                withPolicy("((auth.uid() IS NOT NULL) AND (user_id = auth.uid()))")
            )
        ).toEqual([]);
    });

    it("does NOT flag the corrected form that rejects the anonymous sentinel", () => {
        expect(
            policyAnonymousTautology.run(
                withPolicy("((auth.uid() IS NOT NULL) AND (auth.uid() <> 'anonymous'::text))")
            )
        ).toEqual([]);
    });

    it("does NOT flag an ordinary ownership check", () => {
        expect(policyAnonymousTautology.run(withPolicy("(user_id = auth.uid())"))).toEqual([]);
    });

    it("does NOT flag a plain column null test", () => {
        expect(policyAnonymousTautology.run(withPolicy("(deleted_at IS NOT NULL)"))).toEqual([]);
    });

    it("ignores restrictive policies and unreachable roles", () => {
        const restrictive = snapshot({
            relations: [table("public", "orders")],
            policies: [
                policy("public", "orders", "p", {
                    permissive: false,
                    using: "(auth.uid() IS NOT NULL)",
                    roles: ["anon"]
                })
            ]
        });
        expect(policyAnonymousTautology.run(restrictive)).toEqual([]);

        const unreachable = snapshot({
            relations: [table("public", "orders")],
            policies: [
                policy("public", "orders", "p", {
                    using: "(auth.uid() IS NOT NULL)",
                    roles: ["service_role"]
                })
            ]
        });
        expect(policyAnonymousTautology.run(unreachable)).toEqual([]);
    });
});
