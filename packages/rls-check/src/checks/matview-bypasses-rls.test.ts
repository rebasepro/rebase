import { describe, expect, it } from "vitest";

import { grant, matviewRelation, snapshot, table, view, viewRelation } from "../../test/fixtures/snapshot";
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

    it("does NOT flag one that nothing untrusted can read", () => {
        expect(matviewBypassesRls.run(scenario({ grants: [] }))).toEqual([]);
    });
});
