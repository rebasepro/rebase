import { describe, expect, it } from "vitest";

import { grant, policy, role, snapshot, table, DEFAULT_ROLES } from "../../test/fixtures/snapshot";
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

    it("revokes the write from the role the grant names, when anon holds it through membership", () => {
        // `REVOKE INSERT … FROM anon` is a no-op when anon holds nothing itself.
        const [f] = anonymousWriteAllowed.run(
            snapshot({
                relations: [table("public", "comments", { rlsEnabled: true, columns: ["id", "user_id"] })],
                roles: [
                    ...DEFAULT_ROLES.filter((r) => r.name !== "anon"),
                    role("anon", { memberOf: ["app_writer"] }),
                    role("app_writer")
                ],
                policies: [
                    policy("public", "comments", "p", { command: "INSERT", roles: ["anon"], withCheck: "true" })
                ],
                grants: [grant("public", "comments", "app_writer", ["INSERT"])]
            })
        );

        expect(f.fix).toContain('REVOKE INSERT ON "public"."comments" FROM "app_writer";');
        expect(f.fix).not.toContain('FROM "anon"');
    });

    it("flags a policy aimed at a role anon inherits", () => {
        // `TO app_writer` reaches anon when anon is a member of app_writer; a
        // check that compared names only scanned this clean.
        const findings = anonymousWriteAllowed.run(
            snapshot({
                relations: [table("public", "comments", { rlsEnabled: true, columns: ["id", "user_id"] })],
                roles: [
                    ...DEFAULT_ROLES.filter((r) => r.name !== "anon"),
                    role("anon", { memberOf: ["app_writer"] }),
                    role("app_writer")
                ],
                policies: [
                    policy("public", "comments", "p", { command: "INSERT", roles: ["app_writer"], withCheck: "true" })
                ],
                grants: [grant("public", "comments", "app_writer", ["INSERT"])]
            })
        );

        expect(findings).toHaveLength(1);
        expect(findings[0].confidence).toBe("certain");
        expect(findings[0].detail).toContain("anon");
        expect(findings[0].fix).toContain('REVOKE INSERT ON "public"."comments" FROM "app_writer";');
    });

    it("does NOT flag a policy aimed at a role no anonymous role inherits", () => {
        expect(
            anonymousWriteAllowed.run(
                snapshot({
                    relations: [table("public", "comments", { rlsEnabled: true })],
                    roles: [...DEFAULT_ROLES, role("app_writer")],
                    policies: [
                        policy("public", "comments", "p", { command: "INSERT", roles: ["app_writer"], withCheck: "true" })
                    ],
                    grants: [grant("public", "comments", "app_writer", ["INSERT"])]
                })
            )
        ).toEqual([]);
    });

    /**
     * Rebase has no `anon` role: every request runs as `rebase_user`, a
     * signed-out one too when the API admits it (`AUTH_REQUIRE=false`), and
     * every guest account. The database cannot see that switch, so the
     * finding is heuristic — but it is a finding, where the check used to be
     * blind on Rebase altogether.
     */
    describe("on Rebase", () => {
        const rebaseDb = (p: ReturnType<typeof policy>, grantee = "rebase_user", platform: "rebase" | "unknown" = "rebase") =>
            snapshot({
                platform,
                exposedRoles: ["PUBLIC", "rebase_user"],
                roles: [role("postgres", { canLogin: true, superuser: true }), role("rebase_user")],
                relations: [table("public", "comments", { rlsEnabled: true, columns: ["id", "user_id"] })],
                policies: [p],
                grants: [grant("public", "comments", grantee, ["SELECT", "INSERT", "UPDATE", "DELETE"])]
            });

        it("flags a write policy for every role whose check accepts any row, as heuristic", () => {
            const findings = anonymousWriteAllowed.run(
                rebaseDb(policy("public", "comments", "comments_insert_x", { command: "INSERT", withCheck: "true" }))
            );

            expect(findings).toHaveLength(1);
            expect(findings[0].severity).toBe("high");
            expect(findings[0].confidence).toBe("heuristic");
            expect(findings[0].detail).toContain("rebase_user");
            expect(findings[0].detail).toContain("AUTH_REQUIRE");
        });

        it("flags one aimed at rebase_user by name", () => {
            const [f] = anonymousWriteAllowed.run(
                rebaseDb(policy("public", "comments", "p", { command: "ALL", roles: ["rebase_user"], using: "true" }))
            );

            expect(f.title).toContain("insert, update and delete");
        });

        it("does NOT flag a write scoped to the caller", () => {
            expect(
                anonymousWriteAllowed.run(
                    rebaseDb(policy("public", "comments", "p", {
                        command: "INSERT",
                        withCheck: "(user_id = rebase.uid())"
                    }))
                )
            ).toEqual([]);
        });

        it("does NOT treat rebase_user as anonymous on a database that is not a Rebase app", () => {
            expect(
                anonymousWriteAllowed.run(
                    rebaseDb(policy("public", "comments", "p", { command: "INSERT", withCheck: "true" }), "rebase_user", "unknown")
                )
            ).toEqual([]);
        });

        it("is certain when a named anonymous role holds the write too", () => {
            const snap = rebaseDb(policy("public", "comments", "p", { command: "INSERT", withCheck: "true" }));
            snap.roles = [...snap.roles, role("anon")];
            snap.grants.push(grant("public", "comments", "anon", ["INSERT"]));

            const [f] = anonymousWriteAllowed.run(snap);
            expect(f.confidence).toBe("certain");
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
