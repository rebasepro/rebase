import { describe, expect, it } from "vitest";

import { grant, role, snapshot, table, view, viewRelation, DEFAULT_ROLES } from "../../test/fixtures/snapshot";
import { viewBypassesRls } from "./view-bypasses-rls";

const scenario = (
    securityInvoker: boolean | null,
    extra: Partial<Parameters<typeof snapshot>[0]> = {}
) =>
    snapshot({
        relations: [
            table("public", "orders", { rlsEnabled: true }),
            viewRelation("public", "order_summary")
        ],
        views: [
            view("public", "order_summary", {
                securityInvoker,
                dependsOn: [{ schema: "public", table: "orders" }]
            })
        ],
        grants: [grant("public", "order_summary", "anon", ["SELECT"])],
        ...extra
    });

describe("view-bypasses-rls", () => {
    it("flags a definer-rights view over an RLS-protected table", () => {
        const findings = viewBypassesRls.run(scenario(false));

        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("critical");
        expect(findings[0].confidence).toBe("certain");
        expect(findings[0].fix).toContain(
            'ALTER VIEW "public"."order_summary" SET (security_invoker = true);'
        );
    });

    it("on a server without security_invoker, revokes from every role the view reaches", () => {
        const [f] = viewBypassesRls.run(
            scenario(null, {
                serverVersionNum: 140010,
                serverVersion: "14.10",
                roles: [
                    ...DEFAULT_ROLES.filter((r) => r.name !== "anon"),
                    role("anon", { memberOf: ["app_reader"] }),
                    role("app_reader")
                ],
                grants: [
                    grant("public", "order_summary", "app_reader", ["SELECT"]),
                    grant("public", "order_summary", "authenticated", ["SELECT"])
                ]
            })
        );

        expect(f.fix).toContain('REVOKE SELECT ON "public"."order_summary" FROM "app_reader";');
        expect(f.fix).toContain('REVOKE SELECT ON "public"."order_summary" FROM "authenticated";');
        expect(f.fix).not.toContain('FROM "anon"');
    });

    it("does NOT flag a view with security_invoker = true", () => {
        expect(viewBypassesRls.run(scenario(true))).toEqual([]);
    });

    it("does NOT flag a view whose base tables have no RLS", () => {
        const findings = viewBypassesRls.run(
            scenario(false, {
                relations: [
                    table("public", "orders", { rlsEnabled: false }),
                    viewRelation("public", "order_summary")
                ]
            })
        );

        expect(findings).toEqual([]);
    });

    it("does NOT flag a view nothing untrusted can select from", () => {
        expect(viewBypassesRls.run(scenario(false, { grants: [] }))).toEqual([]);
    });

    it("does NOT flag when dependencies could not be resolved", () => {
        const findings = viewBypassesRls.run(
            scenario(false, {
                views: [view("public", "order_summary", { securityInvoker: false, dependsOn: [] })]
            })
        );

        expect(findings).toEqual([]);
    });

    it("degrades to heuristic before PG 15, where the option does not exist", () => {
        const findings = viewBypassesRls.run(
            scenario(null, { serverVersionNum: 140010, serverVersion: "14.10" })
        );

        expect(findings).toHaveLength(1);
        expect(findings[0].confidence).toBe("heuristic");
        expect(findings[0].detail).toContain("does not exist");
        expect(findings[0].fix).toContain("PostgreSQL 15 or newer");
    });

    it("leaves materialized views to their own check", () => {
        const findings = viewBypassesRls.run(
            scenario(null, {
                relations: [
                    table("public", "orders", { rlsEnabled: true }),
                    table("public", "order_summary", { kind: "materialized_view" })
                ]
            })
        );

        expect(findings).toEqual([]);
    });
});
