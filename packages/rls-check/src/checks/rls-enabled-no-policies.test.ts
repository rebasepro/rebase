import { describe, expect, it } from "vitest";

import { policy, snapshot, table } from "../../test/fixtures/snapshot";
import { rlsEnabledNoPolicies } from "./rls-enabled-no-policies";

describe("rls-enabled-no-policies", () => {
    it("flags RLS on with no policies", () => {
        const findings = rlsEnabledNoPolicies.run(
            snapshot({ relations: [table("public", "orders", { rlsEnabled: true })] })
        );

        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("medium");
        expect(findings[0].confidence).toBe("certain");
        // This is a correctness finding, not an exposure one — the impact line
        // has to say so, because "medium severity" otherwise reads as a leak.
        expect(findings[0].impact).toContain("No data is exposed");
    });

    it("names the owner as the reason it still looks fine from psql", () => {
        const [f] = rlsEnabledNoPolicies.run(
            snapshot({ relations: [table("public", "orders", { rlsEnabled: true, owner: "app" })] })
        );

        expect(f.detail).toContain("app");
    });

    it("notes when FORCE closes even the owner's access", () => {
        const [f] = rlsEnabledNoPolicies.run(
            snapshot({
                relations: [table("public", "orders", { rlsEnabled: true, rlsForced: true })]
            })
        );

        expect(f.detail).toContain("even the owner sees nothing");
    });

    it("does NOT flag a table that has a policy", () => {
        const findings = rlsEnabledNoPolicies.run(
            snapshot({
                relations: [table("public", "orders", { rlsEnabled: true })],
                policies: [policy("public", "orders", "p", { using: "(user_id = auth.uid())" })]
            })
        );

        expect(findings).toEqual([]);
    });

    it("does NOT flag a table with RLS off", () => {
        expect(
            rlsEnabledNoPolicies.run(snapshot({ relations: [table("public", "orders")] }))
        ).toEqual([]);
    });
});

describe("rls-enabled-no-policies: the printed fix", () => {
    // It created a policy on `user_id` for every table, and a table without
    // one refused the pasted SQL.
    it("scopes by an owner column the table has", () => {
        const [f] = rlsEnabledNoPolicies.run(
            snapshot({ relations: [table("public", "notes", { rlsEnabled: true, columns: ["id", "owner_id"] })] })
        );
        expect(f.fix).toMatch(/^CREATE POLICY[^;]*USING \("owner_id" = /m);
        expect(f.fix).not.toContain("user_id");
    });

    it("leaves the statement commented when no column looks like the owner", () => {
        const [f] = rlsEnabledNoPolicies.run(
            snapshot({ relations: [table("public", "tags", { rlsEnabled: true, columns: ["id", "label"] })] })
        );
        expect(f.fix).not.toMatch(/^CREATE POLICY/m);
        expect(f.fix).toContain("-- CREATE POLICY");
        expect(f.fix).toContain("<owner_column>");
    });
});
