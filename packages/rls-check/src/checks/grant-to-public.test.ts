import { describe, expect, it } from "vitest";

import { grant, snapshot, table, viewRelation } from "../../test/fixtures/snapshot";
import { grantToPublic } from "./grant-to-public";

describe("grant-to-public", () => {
    it("flags a DML grant to PUBLIC", () => {
        const findings = grantToPublic.run(
            snapshot({
                relations: [table("public", "orders")],
                grants: [grant("public", "orders", "PUBLIC", ["SELECT", "INSERT"])]
            })
        );

        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("medium");
        expect(findings[0].fix).toContain(
            'REVOKE SELECT, INSERT ON "public"."orders" FROM PUBLIC;'
        );
    });

    it("changes the impact wording when RLS is enabled", () => {
        const [f] = grantToPublic.run(
            snapshot({
                relations: [table("public", "orders", { rlsEnabled: true })],
                grants: [grant("public", "orders", "public", ["SELECT"])]
            })
        );

        expect(f.impact).toContain("what they get back depends entirely on the policies");
    });

    it("does NOT flag a grant to a named role", () => {
        const findings = grantToPublic.run(
            snapshot({
                relations: [table("public", "orders")],
                grants: [grant("public", "orders", "anon", ["SELECT"])]
            })
        );

        expect(findings).toEqual([]);
    });

    it("does NOT flag non-DML privileges", () => {
        const findings = grantToPublic.run(
            snapshot({
                relations: [table("public", "orders")],
                grants: [grant("public", "orders", "PUBLIC", ["REFERENCES", "TRIGGER"])]
            })
        );

        expect(findings).toEqual([]);
    });

    it("does NOT flag a view — the view checks judge those on their own terms", () => {
        const findings = grantToPublic.run(
            snapshot({
                relations: [viewRelation("public", "order_summary")],
                grants: [grant("public", "order_summary", "PUBLIC", ["SELECT"])]
            })
        );

        expect(findings).toEqual([]);
    });
});
