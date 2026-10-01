import { describe, expect, it } from "vitest";

import { policy, reachable, snapshot, table } from "../../test/fixtures/snapshot";
import type { DbSnapshot } from "../types";
import { policyAnonymousTautology as check } from "./policy-anonymous-tautology";

// These tests are about the policy's shape; `reachable` grants every table to
// the exposed roles, because a policy on a table nobody can reach is not reported.
const policyAnonymousTautology = { run: (s: DbSnapshot) => check.run(reachable(s)) };

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

        /**
         * `auth.uid()` being NULL for a signed-out request is a fact about
         * `auth.uid()`, not about Supabase. A signed-out request there still
         * carries a JWT — the project's anon key, shipped in every client — so
         * `auth.role()` is `'anon'` and `auth.jwt()` is that key's claims. Both
         * are non-null, and `USING (auth.jwt() IS NOT NULL)` hands the table to
         * anyone. It used to be graded `low` and described as "anonymous
         * callers are correctly excluded", which passed `--fail-on high`.
         */
        it.each([
            ["(auth.jwt() IS NOT NULL)", "auth.jwt()"],
            ["(auth.role() IS NOT NULL)", "auth.role()"],
            ["(( SELECT auth.jwt() AS jwt) IS NOT NULL)", "auth.jwt()"],
            [
                "(current_setting('request.jwt.claims'::text, true) IS NOT NULL)",
                "current_setting('request.jwt.claims')"
            ],
            [
                "(current_setting('request.jwt.claim.role'::text, true) IS NOT NULL)",
                "current_setting('request.jwt.claim.role')"
            ]
        ])("is `critical` on Supabase for %s, which a signed-out request satisfies", (using, shape) => {
            const [f] = policyAnonymousTautology.run(withPolicy(using, "supabase"));

            expect(f.severity).toBe("critical");
            expect(f.title).toContain(shape);
            expect(f.detail).toContain("anon key");
            expect(f.detail).not.toContain("returns NULL for an anonymous request");
            expect(f.impact).not.toContain("correctly excluded");
            expect(f.impact).toContain("unauthenticated");
        });

        it("stays `low` on Supabase for the calls a signed-out request leaves NULL", () => {
            for (const using of [
                "(auth.uid() IS NOT NULL)",
                "(current_setting('request.jwt.claim.sub'::text, true) IS NOT NULL)"
            ]) {
                const [f] = policyAnonymousTautology.run(withPolicy(using, "supabase"));
                expect(f.severity, using).toBe("low");
                expect(f.impact, using).toContain("not an anonymous-access hole");
            }
        });

        it("says which call it means when it explains the NULL", () => {
            const [f] = policyAnonymousTautology.run(
                withPolicy("(current_setting('request.jwt.claim.sub'::text, true) IS NOT NULL)", "supabase")
            );

            expect(f.detail).toContain("current_setting('request.jwt.claim.sub')");
            expect(f.detail).not.toContain("`auth.uid()` returns NULL");
        });

        it("is `medium` on Supabase for a setting Supabase does not define", () => {
            // Nothing on Supabase sets `app.user_id`; what a signed-out request
            // carries there depends on whatever does.
            const [f] = policyAnonymousTautology.run(
                withPolicy("(current_setting('app.user_id'::text, true) IS NOT NULL)", "supabase")
            );

            expect(f.severity).toBe("medium");
            expect(f.impact).not.toContain("correctly excluded");
        });

        it("reads `auth.role() <> 'anon'` as the real guard it is on Supabase", () => {
            // 'anon' is a decoy for an id — no signed-out caller arrives with
            // that id — but it is exactly the role one arrives as. Reporting it
            // as "excludes 'anon', which is not the anonymous sentinel" would be
            // a false critical now that the role call grades critical.
            expect(
                policyAnonymousTautology.run(
                    withPolicy("((auth.role() IS NOT NULL) AND (auth.role() <> 'anon'::text))", "supabase")
                )
            ).toEqual([]);
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
