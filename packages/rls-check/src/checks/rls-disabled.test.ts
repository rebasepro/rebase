import { describe, expect, it } from "vitest";

import { grant, role, snapshot, table } from "../../test/fixtures/snapshot";
import { rlsDisabled } from "./rls-disabled";

describe("rls-disabled", () => {
    it("flags a table with RLS off that anon can read", () => {
        const findings = rlsDisabled.run(
            snapshot({
                relations: [table("public", "orders", { estimatedRows: 12000 })],
                grants: [grant("public", "orders", "anon", ["SELECT"])]
            })
        );

        expect(findings).toHaveLength(1);
        expect(findings[0].id).toBe("rls-disabled");
        expect(findings[0].severity).toBe("critical");
        expect(findings[0].confidence).toBe("certain");
        expect(findings[0].target).toMatchObject({ schema: "public", table: "orders" });
        expect(findings[0].fix).toContain('ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;');
        expect(findings[0].docs).toBe("https://rebase.pro/docs/rls-check#rls-disabled");
    });

    it("does not claim reachability it cannot know", () => {
        const [f] = rlsDisabled.run(
            snapshot({
                relations: [table("public", "orders")],
                grants: [grant("public", "orders", "anon", ["SELECT"])]
            })
        );

        expect(f.impact).toMatch(/^If this table is reachable over an API/);
    });

    it("stays quiet when nothing untrusted holds a grant", () => {
        const findings = rlsDisabled.run(
            snapshot({
                relations: [table("public", "internal_jobs")],
                grants: [grant("public", "internal_jobs", "postgres", ["SELECT", "INSERT"])]
            })
        );

        expect(findings).toEqual([]);
    });

    it("ignores a grant of TRUNCATE alone — it is not data exposure", () => {
        const findings = rlsDisabled.run(
            snapshot({
                relations: [table("public", "orders")],
                grants: [grant("public", "orders", "anon", ["TRUNCATE", "REFERENCES"])]
            })
        );

        expect(findings).toEqual([]);
    });

    it("stays quiet when RLS is on", () => {
        const findings = rlsDisabled.run(
            snapshot({
                relations: [table("public", "orders", { rlsEnabled: true })],
                grants: [grant("public", "orders", "anon", ["SELECT"])]
            })
        );

        expect(findings).toEqual([]);
    });

    it("follows role membership: a grant to a role anon inherits is a grant to anon", () => {
        const findings = rlsDisabled.run(
            snapshot({
                relations: [table("public", "orders")],
                roles: [
                    role("app_reader"),
                    role("anon", { memberOf: ["app_reader"] }),
                    role("authenticated")
                ],
                grants: [grant("public", "orders", "app_reader", ["SELECT"])]
            })
        );

        expect(findings).toHaveLength(1);
        expect(findings[0].title).toContain("anon");
    });

    it("ignores tables outside the scanned schemas", () => {
        const findings = rlsDisabled.run(
            snapshot({
                schemas: ["public"],
                relations: [table("auth", "users")],
                grants: [grant("auth", "users", "anon", ["SELECT"])]
            })
        );

        expect(findings).toEqual([]);
    });

    it("ignores views — they have their own checks", () => {
        const findings = rlsDisabled.run(
            snapshot({
                relations: [table("public", "order_summary", { kind: "view" })],
                grants: [grant("public", "order_summary", "anon", ["SELECT"])]
            })
        );

        expect(findings).toEqual([]);
    });
});
