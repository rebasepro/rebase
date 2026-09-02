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

    describe("a guard naming the wrong literal", () => {
        /**
         * The two policies that were live on the same production database on
         * 2026-09-02, differing only in the literals they exclude. `rebase.users`
         * was readable by anyone for three and a half weeks; `public.talents`,
         * carrying the same policy shape spelled correctly, returned 0 rows
         * throughout. This tool was run against that database and reported clean,
         * so the pair is kept verbatim.
         */
        const usersPolicy = snapshot({
            platform: "rebase",
            schemas: ["public", "rebase"],
            relations: [table("rebase", "users")],
            policies: [
                policy("rebase", "users", "authenticated_access", {
                    command: "ALL",
                    roles: ["public"],
                    using: "((auth.uid() IS NOT NULL) AND (auth.uid() <> 'anon'::text))"
                })
            ]
        });

        const talentsPolicy = snapshot({
            platform: "rebase",
            relations: [table("public", "talents")],
            policies: [
                policy("public", "talents", "require_real_user", {
                    command: "ALL",
                    roles: ["public"],
                    using:
                        "((auth.uid() IS NOT NULL) AND (auth.uid() <> ALL (ARRAY['anon'::text, " +
                        "'anonymous'::text])))"
                })
            ]
        });

        it("fires on `<> 'anon'`, because the sentinel is 'anonymous'", () => {
            const findings = policyAnonymousTautology.run(usersPolicy);

            expect(findings).toHaveLength(1);
            expect(findings[0].title).toContain("'anon'");
            expect(findings[0].title).toContain("not the anonymous sentinel");
            expect(findings[0].detail).toContain("the guard excludes nobody");
        });

        it("stays silent on `<> ALL (ARRAY['anon', 'anonymous'])`, which does exclude them", () => {
            expect(policyAnonymousTautology.run(talentsPolicy)).toEqual([]);
        });

        it("does not depend on how heavily Postgres parenthesised it", () => {
            // The two spellings as they were read off `pg_policies.qual`, without
            // the redundant parens the rewriter usually adds.
            expect(
                policyAnonymousTautology.run(
                    withPolicy("auth.uid() IS NOT NULL AND auth.uid() <> 'anon'", "rebase")
                )
            ).toHaveLength(1);

            expect(
                policyAnonymousTautology.run(
                    withPolicy(
                        "auth.uid() IS NOT NULL AND auth.uid() <> ALL (ARRAY['anon', 'anonymous'])",
                        "rebase"
                    )
                )
            ).toEqual([]);
        });

        it("reads the `rebase.uid()` spelling the same way", () => {
            expect(
                policyAnonymousTautology.run(
                    withPolicy("(rebase.uid() IS NOT NULL) AND (rebase.uid() <> 'anon'::text)", "rebase")
                )
            ).toHaveLength(1);
        });

        it("reads NOT IN the same way as <> ALL", () => {
            expect(
                policyAnonymousTautology.run(
                    withPolicy("((auth.uid() IS NOT NULL) AND (auth.uid() NOT IN ('anon', 'anonymous')))")
                )
            ).toEqual([]);

            expect(
                policyAnonymousTautology.run(
                    withPolicy("((auth.uid() IS NOT NULL) AND (auth.uid() NOT IN ('anon', 'guest')))")
                )
            ).toHaveLength(1);
        });

        it("accepts the empty string as a sentinel, for stacks that leave a claim unset", () => {
            expect(
                policyAnonymousTautology.run(
                    withPolicy("((auth.uid() IS NOT NULL) AND (auth.uid() <> ''::text))")
                )
            ).toEqual([]);
        });

        it("still says nothing when a conjunct actually scopes the row", () => {
            expect(
                policyAnonymousTautology.run(
                    withPolicy("((auth.uid() IS NOT NULL) AND (auth.uid() <> 'anon') AND (user_id = auth.uid()))")
                )
            ).toEqual([]);
        });

        it("says nothing when an OR could admit rows on another branch", () => {
            expect(
                policyAnonymousTautology.run(
                    withPolicy("((auth.uid() IS NOT NULL) AND ((auth.uid() <> 'anon') OR (is_public = true)))")
                )
            ).toEqual([]);
        });
    });

    describe("a policy governing writes is worse than one governing reads", () => {
        const withCommand = (command: "SELECT" | "ALL" | "UPDATE" | "DELETE" | "INSERT") =>
            snapshot({
                platform: "supabase",
                relations: [table("public", "orders")],
                policies: [
                    policy("public", "orders", "orders_rw", {
                        command,
                        using: "(auth.uid() IS NOT NULL)",
                        roles: ["authenticated"]
                    })
                ]
            });

        it("keeps the platform reading for SELECT and INSERT", () => {
            expect(policyAnonymousTautology.run(withCommand("SELECT"))[0].severity).toBe("low");
            expect(policyAnonymousTautology.run(withCommand("INSERT"))[0].severity).toBe("low");
        });

        it("raises it one step for ALL, UPDATE and DELETE", () => {
            for (const command of ["ALL", "UPDATE", "DELETE"] as const) {
                const [f] = policyAnonymousTautology.run(withCommand(command));
                expect(f.severity, command).toBe("medium");
            }
        });

        it("says out loud that the expression decides who may write", () => {
            expect(policyAnonymousTautology.run(withCommand("ALL"))[0].detail).toContain(
                "every command, writes included"
            );
        });

        it("does not climb past critical", () => {
            const rebase = snapshot({
                platform: "rebase",
                relations: [table("public", "orders")],
                policies: [
                    policy("public", "orders", "p", {
                        command: "ALL",
                        using: "(auth.uid() IS NOT NULL)",
                        roles: ["authenticated"]
                    })
                ]
            });
            expect(policyAnonymousTautology.run(rebase)[0].severity).toBe("critical");
        });
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
