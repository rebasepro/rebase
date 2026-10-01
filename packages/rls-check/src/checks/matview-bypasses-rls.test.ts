import { describe, expect, it } from "vitest";

import { grant, matviewRelation, role, snapshot, table, view, viewRelation, DEFAULT_ROLES } from "../../test/fixtures/snapshot";
import { matviewBypassesRls } from "./matview-bypasses-rls";

const scenario = (extra: Partial<Parameters<typeof snapshot>[0]> = {}) =>
    snapshot({
        relations: [
            table("public", "orders", { rlsEnabled: true }),
            matviewRelation("public", "daily_orders")
        ],
        views: [
            view("public", "daily_orders", {
                securityInvoker: null,
                dependsOn: [{ schema: "public", table: "orders" }]
            })
        ],
        grants: [grant("public", "daily_orders", "anon", ["SELECT"])],
        ...extra
    });

describe("matview-bypasses-rls", () => {
    it("flags a materialized view over an RLS-protected table", () => {
        const findings = matviewBypassesRls.run(scenario());

        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("high");
        expect(findings[0].confidence).toBe("certain");
        expect(findings[0].impact).toContain("No policy can restrict this");
        expect(findings[0].fix).toContain('REVOKE SELECT ON "public"."daily_orders" FROM "anon";');
    });

    it("does NOT flag a plain view — that is view-bypasses-rls's job", () => {
        const findings = matviewBypassesRls.run(
            scenario({
                relations: [
                    table("public", "orders", { rlsEnabled: true }),
                    viewRelation("public", "daily_orders")
                ]
            })
        );

        expect(findings).toEqual([]);
    });

    it("does NOT flag a materialized view over unprotected tables", () => {
        const findings = matviewBypassesRls.run(
            scenario({
                relations: [table("public", "orders"), matviewRelation("public", "daily_orders")]
            })
        );

        expect(findings).toEqual([]);
    });

    /**
     * The printed fix used to revoke from the first exposed role only. Applied
     * and rescanned, every one of these still had the finding.
     */
    describe("its fix takes the matview away from every role that reaches it", () => {
        it("revokes from each exposed role it is granted to", () => {
            const [f] = matviewBypassesRls.run(
                scenario({
                    grants: [grant("public", "daily_orders", "anon", ["SELECT"]),
                        grant("public", "daily_orders", "authenticated", ["SELECT"])]
                })
            );

            expect(f.fix).toContain('REVOKE SELECT ON "public"."daily_orders" FROM "anon";');
            expect(f.fix).toContain('REVOKE SELECT ON "public"."daily_orders" FROM "authenticated";');
        });

        it("revokes from the role the grant names, when anon reaches it through membership", () => {
            // `REVOKE … FROM anon` is a no-op here: anon holds nothing itself.
            const [f] = matviewBypassesRls.run(
                scenario({
                    roles: [
                        ...DEFAULT_ROLES.filter((r) => r.name !== "anon"),
                        role("anon", { memberOf: ["app_reader"] }),
                        role("app_reader")
                    ],
                    grants: [grant("public", "daily_orders", "app_reader", ["SELECT"])]
                })
            );

            expect(f.fix).toContain('REVOKE SELECT ON "public"."daily_orders" FROM "app_reader";');
            expect(f.fix).not.toContain('FROM "anon"');
        });

        it("revokes a grant to PUBLIC from PUBLIC", () => {
            const [f] = matviewBypassesRls.run(
                scenario({ grants: [grant("public", "daily_orders", "PUBLIC", ["SELECT"])] })
            );

            expect(f.fix).toContain('REVOKE SELECT ON "public"."daily_orders" FROM PUBLIC;');
        });
    });

    it("does NOT flag one that nothing untrusted can read", () => {
        expect(matviewBypassesRls.run(scenario({ grants: [] }))).toEqual([]);
    });
});
