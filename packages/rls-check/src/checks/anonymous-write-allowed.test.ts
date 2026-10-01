import { describe, expect, it } from "vitest";

import { grant, policy, snapshot, table } from "../../test/fixtures/snapshot";
import { anonymousWriteAllowed } from "./anonymous-write-allowed";

const scenario = (
    policies: ReturnType<typeof policy>[],
    grants = [grant("public", "comments", "anon", ["SELECT", "INSERT", "UPDATE", "DELETE"])]
) =>
    snapshot({
        relations: [table("public", "comments", { rlsEnabled: true, columns: ["id", "user_id"] })],
        policies,
        grants
    });

describe("anonymous-write-allowed", () => {
    it("flags an INSERT policy for anon whose check is a constant truth", () => {
        const findings = anonymousWriteAllowed.run(
            scenario([
                policy("public", "comments", "anon_insert", { command: "INSERT", roles: ["anon"], withCheck: "true" })
            ])
        );

        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("high");
        expect(findings[0].confidence).toBe("certain");
        expect(findings[0].title).toContain("insert");
        expect(findings[0].fix).toContain("REVOKE INSERT");
    });

    it("flags a FOR ALL policy with USING (true) and reports every granted write", () => {
        const [f] = anonymousWriteAllowed.run(
            scenario([
                policy("public", "comments", "anon_all", {
                    command: "ALL",
                    roles: ["public"],
                    using: "true",
                    withCheck: "true"
                })
            ])
        );

        expect(f.title).toContain("insert, update and delete");
    });

    it("does NOT flag a correctly scoped anon policy — the Supabase default shape", () => {
        const findings = anonymousWriteAllowed.run(
            scenario([
                policy("public", "comments", "own_rows", {
                    command: "INSERT",
                    roles: ["anon"],
                    withCheck: "(user_id = auth.uid())"
                })
            ])
        );

        expect(findings).toEqual([]);
    });

    it("does NOT flag a wide-open policy with no matching grant", () => {
        const findings = anonymousWriteAllowed.run(
            scenario(
                [policy("public", "comments", "anon_insert", { command: "INSERT", roles: ["anon"], withCheck: "true" })],
                [grant("public", "comments", "anon", ["SELECT"])]
            )
        );

        expect(findings).toEqual([]);
    });

    it("does NOT flag a SELECT policy", () => {
        const findings = anonymousWriteAllowed.run(
            scenario([
                policy("public", "comments", "anon_read", {
                    command: "SELECT",
                    roles: ["anon"],
                    using: "true"
                })
            ])
        );

        expect(findings).toEqual([]);
    });

    it("does NOT flag a write policy aimed only at authenticated callers", () => {
        const findings = anonymousWriteAllowed.run(
            scenario([
                policy("public", "comments", "auth_insert", {
                    command: "INSERT",
                    roles: ["authenticated"],
                    withCheck: "true"
                })
            ])
        );

        expect(findings).toEqual([]);
    });

    /**
     * A clause a policy does not have is not a clause that is true. Postgres
     * only ORs together the expressions permissive policies *have*; one with
     * none contributes nothing, and with nothing else the default is deny.
     * Each of these was reported high and certain while anon could not write.
     */
    describe("a missing clause denies", () => {
        it("does NOT flag an INSERT policy with no WITH CHECK — the insert is refused", () => {
            expect(
                anonymousWriteAllowed.run(
                    scenario([policy("public", "comments", "p", { command: "INSERT", roles: ["anon"] })])
                )
            ).toEqual([]);
        });

        it("does NOT flag a DELETE policy with no USING — it deletes no row", () => {
            expect(
                anonymousWriteAllowed.run(
                    scenario([policy("public", "comments", "p", { command: "DELETE", roles: ["anon"] })])
                )
            ).toEqual([]);
        });

        it("does NOT flag an UPDATE policy with only WITH CHECK (true) — it reaches no row", () => {
            expect(
                anonymousWriteAllowed.run(
                    scenario([
                        policy("public", "comments", "p", { command: "UPDATE", roles: ["anon"], withCheck: "true" })
                    ])
                )
            ).toEqual([]);
        });

        it("reports only INSERT for a FOR ALL policy with only WITH CHECK (true)", () => {
            // The check admits any new row; with no USING, no existing row can
            // be updated or deleted through this policy.
            const [f] = anonymousWriteAllowed.run(
                scenario([
                    policy("public", "comments", "p", { command: "ALL", roles: ["anon"], withCheck: "true" })
                ])
            );

            expect(f.title).toContain("unauthenticated insert via");
            expect(f.fix).toContain('REVOKE INSERT ON');
            expect(f.detail).not.toContain("absent");
        });

        it("reports every write for a FOR ALL policy with USING (true), whose check falls back to it", () => {
            const [f] = anonymousWriteAllowed.run(
                scenario([policy("public", "comments", "p", { command: "ALL", roles: ["anon"], using: "true" })])
            );

            expect(f.title).toContain("insert, update and delete");
        });

        it("does NOT flag an UPDATE whose USING is open but whose check scopes the new row", () => {
            expect(
                anonymousWriteAllowed.run(
                    scenario([
                        policy("public", "comments", "p", {
                            command: "UPDATE",
                            roles: ["anon"],
                            using: "true",
                            withCheck: "(user_id = auth.uid())"
                        })
                    ])
                )
            ).toEqual([]);
        });
    });

    it("does NOT flag a restrictive policy", () => {
        const findings = anonymousWriteAllowed.run(
            scenario([
                policy("public", "comments", "gate", {
                    command: "INSERT",
                    roles: ["anon"],
                    permissive: false,
                    withCheck: "true"
                })
            ])
        );

        expect(findings).toEqual([]);
    });
});
