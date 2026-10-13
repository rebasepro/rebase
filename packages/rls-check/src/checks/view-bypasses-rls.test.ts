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

    /**
     * The view runs as its owner, and RLS on the base table applies to that
     * owner unless it is a superuser, holds BYPASSRLS, or owns the table
     * without FORCE. A view owned by a constrained role returns what that
     * role's policies give it — to every caller alike, which may be nothing.
     * Still reported (the result does not depend on the caller), but not as a
     * certain bypass.
     */
    describe("the view's owner", () => {
        const owned = (owner: string, roles = DEFAULT_ROLES, tableSpec: Parameters<typeof table>[2] = {}) =>
            snapshot({
                relations: [
                    table("public", "orders", { rlsEnabled: true, ...tableSpec }),
                    viewRelation("public", "order_summary", { owner })
                ],
                views: [
                    view("public", "order_summary", {
                        owner,
                        securityInvoker: false,
                        dependsOn: [{ schema: "public", table: "orders" }]
                    })
                ],
                grants: [grant("public", "order_summary", "anon", ["SELECT"])],
                roles
            });

        it("is still a certain bypass when the owner owns the base table without FORCE", () => {
            const [f] = viewBypassesRls.run(owned("app_owner", [...DEFAULT_ROLES, role("app_owner")], { owner: "app_owner" }));
            expect(f.confidence).toBe("certain");
        });

        it("is still a certain bypass when the owner is a superuser, FORCE or not", () => {
            const [f] = viewBypassesRls.run(owned("postgres", DEFAULT_ROLES, { rlsForced: true }));
            expect(f.confidence).toBe("certain");
        });

        it("is still a certain bypass when the owner holds BYPASSRLS", () => {
            const [f] = viewBypassesRls.run(
                owned("reporter", [...DEFAULT_ROLES, role("reporter", { bypassRls: true })])
            );
            expect(f.confidence).toBe("certain");
        });

        it("is heuristic, and says why, when the owner is itself subject to the table's policies", () => {
            const findings = viewBypassesRls.run(owned("reporter", [...DEFAULT_ROLES, role("reporter")]));

            expect(findings).toHaveLength(1);
            expect(findings[0].severity).toBe("critical");
            expect(findings[0].confidence).toBe("heuristic");
            expect(findings[0].detail).toContain("reporter is itself subject to");
            expect(findings[0].fix).toContain("security_invoker = true");
        });

        it("is heuristic when the owner owns the base table and FORCE ROW LEVEL SECURITY is set", () => {
            const [f] = viewBypassesRls.run(
                owned("app_owner", [...DEFAULT_ROLES, role("app_owner")], { owner: "app_owner", rlsForced: true })
            );
            expect(f.confidence).toBe("heuristic");
        });

        it("stays certain while any one base table is read past its policies", () => {
            const snap = owned("reporter", [...DEFAULT_ROLES, role("reporter")]);
            snap.relations.push(table("public", "refunds", { rlsEnabled: true, owner: "reporter" }));
            snap.views[0].dependsOn.push({ schema: "public", table: "refunds" });

            const [f] = viewBypassesRls.run(snap);
            expect(f.confidence).toBe("certain");
        });

        it("stays certain when the owner's role could not be read", () => {
            const [f] = viewBypassesRls.run(owned("ghost", DEFAULT_ROLES));
            expect(f.confidence).toBe("certain");
        });
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
