import { describe, expect, it } from "vitest";

import { DEFAULT_ROLES, policy, role, snapshot, table } from "../../test/fixtures/snapshot";
import { policyAlwaysTrue } from "./policy-always-true";
import { isUnconditionalTrue } from "./sql";

const base = (policies: ReturnType<typeof policy>[]) =>
    snapshot({ relations: [table("public", "orders")], policies });

describe("policy-always-true", () => {
    it("flags USING (true) for an exposed role", () => {
        const findings = policyAlwaysTrue.run(
            base([policy("public", "orders", "orders_read", { using: "true", roles: ["anon"] })])
        );

        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("critical");
        expect(findings[0].confidence).toBe("certain");
        expect(findings[0].target.policy).toBe("orders_read");
        expect(findings[0].fix).toContain('ALTER POLICY "orders_read" ON "public"."orders"');
    });

    it("flags a WITH CHECK tautology", () => {
        const [f] = policyAlwaysTrue.run(
            base([
                policy("public", "orders", "orders_write", {
                    command: "INSERT",
                    withCheck: "(1 = 1)",
                    roles: ["public"]
                })
            ])
        );

        expect(f.title).toContain("WITH CHECK");
    });

    it("does NOT flag `true` appearing inside a larger expression", () => {
        const findings = policyAlwaysTrue.run(
            base([
                policy("public", "orders", "public_only", {
                    using: "((is_public = true) AND (owner_id = auth.uid()))",
                    roles: ["anon"]
                })
            ])
        );

        expect(findings).toEqual([]);
    });

    it("does NOT flag a restrictive policy — those AND, they do not grant", () => {
        const findings = policyAlwaysTrue.run(
            base([
                policy("public", "orders", "tenant_gate", {
                    permissive: false,
                    using: "true",
                    roles: ["anon"]
                })
            ])
        );

        expect(findings).toEqual([]);
    });

    it("does NOT flag a policy aimed at a role nothing untrusted reaches", () => {
        const findings = policyAlwaysTrue.run(
            base([policy("public", "orders", "admin_all", { using: "true", roles: ["service_role"] })])
        );

        expect(findings).toEqual([]);
    });

    it("softens to a question when a RESTRICTIVE policy also gates the command", () => {
        const findings = policyAlwaysTrue.run(
            base([
                policy("public", "orders", "orders_read", { using: "true", roles: ["anon"] }),
                policy("public", "orders", "tenant_gate", {
                    permissive: false,
                    using: "(tenant_id = current_setting('app.tenant', true)::uuid)",
                    roles: ["anon"]
                })
            ])
        );

        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("medium");
        expect(findings[0].confidence).toBe("heuristic");
        expect(findings[0].detail).toContain("tenant_gate");
    });

    // A RESTRICTIVE policy only gates the callers it applies to, and only for
    // its own command. Supabase's documented MFA gate is `AS RESTRICTIVE TO
    // authenticated`: next to `USING (true) TO anon` it leaves anon reading
    // every row, and softening that to medium put it under the default
    // `--fail-on high`, so the scan exited 0.
    it("stays critical when the RESTRICTIVE policy applies to other roles only", () => {
        const [f] = policyAlwaysTrue.run(
            base([
                policy("public", "orders", "orders_read", { using: "true", roles: ["anon"] }),
                policy("public", "orders", "require_mfa", {
                    permissive: false,
                    command: "ALL",
                    using: "((auth.jwt() ->> 'aal') = 'aal2')",
                    roles: ["authenticated"]
                })
            ])
        );

        expect(f.severity).toBe("critical");
        expect(f.confidence).toBe("certain");
        expect(f.detail).not.toContain("require_mfa");
    });

    it("stays critical when a PUBLIC policy is gated for only some of the roles it reaches", () => {
        const [f] = policyAlwaysTrue.run(
            base([
                // No TO clause is TO PUBLIC, which reaches anon and authenticated.
                policy("public", "orders", "orders_read", { using: "true", roles: ["public"] }),
                policy("public", "orders", "require_mfa", {
                    permissive: false,
                    using: "((auth.jwt() ->> 'aal') = 'aal2')",
                    roles: ["authenticated"]
                })
            ])
        );

        expect(f.severity).toBe("critical");
    });

    it("stays critical when the RESTRICTIVE policy covers one command of an ALL policy", () => {
        const [f] = policyAlwaysTrue.run(
            base([
                policy("public", "orders", "orders_all", { command: "ALL", using: "true", roles: ["anon"] }),
                policy("public", "orders", "read_gate", {
                    permissive: false,
                    command: "SELECT",
                    using: "(tenant_id = current_setting('app.tenant', true)::uuid)",
                    roles: ["anon"]
                })
            ])
        );

        expect(f.severity).toBe("critical");
    });

    it("softens when a RESTRICTIVE policy applies to a role the exposed one inherits", () => {
        const findings = policyAlwaysTrue.run(
            snapshot({
                relations: [table("public", "orders")],
                roles: [...DEFAULT_ROLES.filter((r) => r.name !== "anon"), role("anon", { memberOf: ["api_callers"] }), role("api_callers")],
                policies: [
                    policy("public", "orders", "orders_read", { using: "true", roles: ["anon"] }),
                    policy("public", "orders", "tenant_gate", {
                        permissive: false,
                        command: "ALL",
                        using: "(tenant_id = current_setting('app.tenant', true)::uuid)",
                        roles: ["api_callers"]
                    })
                ]
            })
        );

        expect(findings[0].severity).toBe("medium");
    });

    it("softens when RESTRICTIVE policies together cover every role the permissive one reaches", () => {
        const [f] = policyAlwaysTrue.run(
            base([
                policy("public", "orders", "orders_read", { using: "true", roles: ["public"] }),
                policy("public", "orders", "anon_gate", {
                    permissive: false,
                    using: "(tenant_id = current_setting('app.tenant', true)::uuid)",
                    roles: ["anon"]
                }),
                policy("public", "orders", "member_gate", {
                    permissive: false,
                    using: "(tenant_id = current_setting('app.tenant', true)::uuid)",
                    roles: ["authenticated"]
                })
            ])
        );

        expect(f.severity).toBe("medium");
        expect(f.detail).toContain("anon_gate");
        expect(f.detail).toContain("member_gate");
    });

    it("stays critical when only PUBLIC reaches the policy and the RESTRICTIVE one names a single role", () => {
        // A plain Postgres database with no known API role: every caller is
        // "some role", and a gate on one named role covers none of the others.
        const [f] = policyAlwaysTrue.run(
            snapshot({
                exposedRoles: ["PUBLIC"],
                relations: [table("public", "orders")],
                policies: [
                    policy("public", "orders", "orders_read", { using: "true", roles: ["public"] }),
                    policy("public", "orders", "app_gate", {
                        permissive: false,
                        using: "(tenant_id = current_setting('app.tenant', true)::uuid)",
                        roles: ["app_user"]
                    })
                ]
            })
        );

        expect(f.severity).toBe("critical");
    });
});

describe("isUnconditionalTrue", () => {
    it.each(["true", "(true)", " TRUE ", "((true))", "1 = 1", "(1 = 1)", "true::boolean"])(
        "treats %j as unconditional",
        (expr) => {
            expect(isUnconditionalTrue(expr)).toBe(true);
        }
    );

    it.each([
        "is_public = true",
        "(true AND owner_id = auth.uid())",
        "1 = 2",
        "false",
        "(owner_id IS NOT NULL)",
        "name = 'true'"
    ])("leaves %j alone", (expr) => {
        expect(isUnconditionalTrue(expr)).toBe(false);
    });

    it("treats a missing clause as not-true", () => {
        expect(isUnconditionalTrue(null)).toBe(false);
        expect(isUnconditionalTrue(undefined)).toBe(false);
    });
});
