import { describe, expect, it } from "vitest";

import { policy, snapshot, table } from "../../test/fixtures/snapshot";
import { currentSettingThrows } from "./current-setting-throws";

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
