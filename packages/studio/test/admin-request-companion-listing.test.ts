import { describe, expect, it } from "@jest/globals";
import { compileRulePolicies, getEffectiveSecurityRules } from "@rebasepro/common";
import type { CollectionConfig, PostgresPolicy } from "@rebasepro/types";
import { listPolicies } from "../src/components/RLSEditor/policyListing";

/**
 * A server that made `rebase_admin_request` safe writes a `USING (true)`
 * companion beside each admin-only policy. The editor lists it as Rebase's,
 * compared against what the server writes — not as a stranger to import, and
 * not as missing where a server wrote none.
 */
const tasks: CollectionConfig = {
    name: "Tasks", slug: "tasks", table: "tasks",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        ownerId: { name: "Owner", type: "string", columnName: "owner_id" }
    },
    securityRules: [{ name: "owner_select", operation: "select", ownerField: "ownerId" }]
};

const companion = (): PostgresPolicy => {
    const read = getEffectiveSecurityRules(tasks).find((rule) => rule.name === "tasks_default_admin_read")!;
    const compiled = compileRulePolicies(tasks, read, { adminRole: true, adminRequestRole: true }).find((p) => p.adminRequestTarget)!;
    return { policyname: compiled.name, tablename: "tasks", permissive: "PERMISSIVE", roles: ["rebase_admin_request"], cmd: "SELECT", qual: "true", with_check: null };
};

describe("an admin-request companion in the RLS editor", () => {
    it("is listed as Rebase's own, with no drift, when the database has it", () => {
        const live = companion();
        const listed = listPolicies([live], tasks, "tasks", [tasks]).find((p) => p.policyname === live.policyname);
        expect(listed).toMatchObject({ status: "both", generated: true });
        expect(listed?.drift ?? []).toEqual([]);
    });

    it("shows drift when it is not the shape a server writes", () => {
        const live = { ...companion(), roles: ["public"] };
        const listed = listPolicies([live], tasks, "tasks", [tasks]).find((p) => p.policyname === live.policyname);
        expect(listed?.status).toBe("both");
        expect((listed?.drift ?? []).length).toBeGreaterThan(0);
    });

    it("is not listed as missing when the database has none", () => {
        const listed = listPolicies([], tasks, "tasks", [tasks]);
        expect(listed.some((p) => p.roles.includes("rebase_admin_request"))).toBe(false);
    });
});
