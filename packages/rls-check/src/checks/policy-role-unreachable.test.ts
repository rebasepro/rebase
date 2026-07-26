import { describe, expect, it } from "vitest";

import { policy, role, snapshot, table } from "../../test/fixtures/snapshot";
import { policyRoleUnreachable } from "./policy-role-unreachable";

const orders = table("public", "orders", { rlsEnabled: true });

describe("policy-role-unreachable", () => {
    it("flags policies aimed at a role that does not exist", () => {
        const findings = policyRoleUnreachable.run(
            snapshot({
                relations: [orders],
                roles: [role("rebase_user"), role("postgres", { canLogin: true, superuser: true })],
                policies: [
                    policy("public", "orders", "p", {
                        roles: ["authenticated"],
                        using: "(user_id = auth.uid())"
                    })
                ]
            })
        );

        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("medium");
        expect(findings[0].detail).toContain("does not exist in pg_roles");
        expect(findings[0].impact).toContain("Nothing is exposed");
    });

    it("does NOT flag `authenticated` on a database where a login role inherits it", () => {
        const findings = policyRoleUnreachable.run(
            snapshot({
                relations: [orders],
                policies: [
                    policy("public", "orders", "p", {
                        roles: ["authenticated"],
                        using: "(user_id = auth.uid())"
                    })
                ]
            })
        );

        expect(findings).toEqual([]);
    });

    it("does NOT flag policies targeting PUBLIC", () => {
        const findings = policyRoleUnreachable.run(
            snapshot({
                relations: [orders],
                policies: [policy("public", "orders", "p", { roles: ["public"] })]
            })
        );

        expect(findings).toEqual([]);
    });

    it("does not fire when even one policy is reachable", () => {
        const findings = policyRoleUnreachable.run(
            snapshot({
                relations: [orders],
                roles: [role("ghost"), role("authenticator", { canLogin: true, memberOf: ["anon"] }), role("anon")],
                policies: [
                    policy("public", "orders", "dead", { roles: ["ghost"] }),
                    policy("public", "orders", "live", { roles: ["anon"] })
                ]
            })
        );

        expect(findings).toEqual([]);
    });

    it("does NOT fire on a table with no policies — that is a different finding", () => {
        expect(policyRoleUnreachable.run(snapshot({ relations: [orders] }))).toEqual([]);
    });

    it("does NOT fire when RLS is off, because the policies do not apply anyway", () => {
        const findings = policyRoleUnreachable.run(
            snapshot({
                relations: [table("public", "orders")],
                roles: [role("ghost")],
                policies: [policy("public", "orders", "p", { roles: ["ghost"] })]
            })
        );

        expect(findings).toEqual([]);
    });

    it("ignores what a superuser could SET ROLE to — the question is where requests land", () => {
        const findings = policyRoleUnreachable.run(
            snapshot({
                relations: [orders],
                roles: [role("postgres", { canLogin: true, superuser: true }), role("ghost")],
                policies: [policy("public", "orders", "p", { roles: ["ghost"] })]
            })
        );

        expect(findings).toHaveLength(1);
    });
});
