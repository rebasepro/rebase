import { describe, expect, it } from "vitest";

import { policy, snapshot, table } from "../../test/fixtures/snapshot";
import { currentSettingThrows, withMissingOk } from "./current-setting-throws";

const withClause = (using: string | null, withCheck: string | null = null) =>
    snapshot({
        relations: [table("public", "orders")],
        policies: [policy("public", "orders", "tenant_scope", { using, withCheck })]
    });

describe("current-setting-throws", () => {
    it("flags a one-argument current_setting()", () => {
        const findings = currentSettingThrows.run(
            withClause("(tenant_id = (current_setting('app.tenant'))::uuid)")
        );

        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("low");
        expect(findings[0].confidence).toBe("heuristic");
        expect(findings[0].title).toContain("'app.tenant'");
        expect(findings[0].fix).toContain("current_setting('app.tenant', true)");
    });

    it("does NOT flag the two-argument form", () => {
        expect(
            currentSettingThrows.run(
                withClause("(tenant_id = (current_setting('app.tenant', true))::uuid)")
            )
        ).toEqual([]);
    });

    it("is not confused by a comma nested inside the first argument's expression", () => {
        const findings = currentSettingThrows.run(
            withClause("(tenant_id = (current_setting(concat('app.', 'tenant')))::uuid)")
        );

        expect(findings).toHaveLength(1);
    });

    it("scans WITH CHECK too", () => {
        const [f] = currentSettingThrows.run(
            withClause(null, "(tenant_id = (current_setting('app.tenant'))::uuid)")
        );

        expect(f.detail).toContain("WITH CHECK");
    });

    it("reports one finding per policy, however many calls it has", () => {
        const findings = currentSettingThrows.run(
            withClause("((tenant_id = (current_setting('a'))::uuid) AND (x = current_setting('b')))")
        );

        expect(findings).toHaveLength(1);
        expect(findings[0].title).toContain("'a'");
        expect(findings[0].title).toContain("'b'");
    });

    it("stays quiet on a policy that does not call current_setting", () => {
        expect(currentSettingThrows.run(withClause("(user_id = auth.uid())"))).toEqual([]);
    });
});

describe("current-setting-throws: the printed fix", () => {
    // The fix was always `USING (tenant_id = current_setting(…, true)::uuid)`:
    // on an INSERT policy, which has no USING, it failed when pasted, and it
    // named a `tenant_id` the table may not have.
    it("rewrites only the clauses that call it, keeping the policy's own expression", () => {
        const insertOnly = snapshot({
            relations: [table("public", "orders")],
            policies: [policy("public", "orders", "ins", {
                command: "INSERT", using: null,
                withCheck: "(org = (current_setting('app.org'::text))::uuid)"
            })]
        });
        const [found] = currentSettingThrows.run(insertOnly);
        expect(found.fix).toContain("WITH CHECK ((org = (current_setting('app.org'::text, true))::uuid))");
        expect(found.fix).not.toContain("USING");
        expect(found.fix).not.toContain("tenant_id");
    });

    it.each([
        ["current_setting('a')", "current_setting('a', true)"],
        ["current_setting('a'::text)", "current_setting('a'::text, true)"],
        ["current_setting(concat('a.', 'b'))", "current_setting(concat('a.', 'b'), true)"],
        ["current_setting('a', true) = current_setting('it''s')", "current_setting('a', true) = current_setting('it''s', true)"],
        ["current_setting('x,y')", "current_setting('x,y', true)"]
    ])("adds missing_ok to %s", (before, after) => {
        expect(withMissingOk(before)).toBe(after);
    });
});
