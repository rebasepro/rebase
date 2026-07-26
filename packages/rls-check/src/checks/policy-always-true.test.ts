import { describe, expect, it } from "vitest";

import { policy, snapshot, table } from "../../test/fixtures/snapshot";
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
