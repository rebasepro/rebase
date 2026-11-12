import { describe, expect, it } from "@jest/globals";
import { col, defineTable } from "@rebasepro/types";
import type { PostgresPolicy } from "@rebasepro/types";
import { declaredPoliciesOf, listPolicies, servedAsPostgresPolicy } from "../src/components/RLSEditor/policyListing";
import { servedTables } from "./helpers/servedTables";

/**
 * A server that made `rebase_admin_request` safe writes a `USING (true)`
 * companion beside each admin-only policy. The server serves it among the
 * table's compiled policies; the editor lists it as Rebase's, compared
 * against what the server writes — not as a stranger to import, and not as
 * missing where a server wrote none.
 */
const [tasks] = servedTables([defineTable("tasks", {
    columns: { id: col.serial().primaryKey(), ownerId: col.text().column("owner_id") },
    rls: [{ name: "owner_select", operation: "select", ownerField: "ownerId" }]
})]);
const declared = declaredPoliciesOf(tasks.rls);

const companion = (): PostgresPolicy => {
    const served = tasks.rls.policies?.find(policy => policy.name.startsWith("tasks_default_admin_read_ar_"));
    if (!served) throw new Error("the server serves no companion");
    return servedAsPostgresPolicy(served, "tasks");
};

describe("an admin-request companion in the RLS editor", () => {
    it("is listed as Rebase's own, with no drift, when the database has it", () => {
        const live = companion();
        const listed = listPolicies([live], declared, "tasks").find((p) => p.policyname === live.policyname);
        expect(listed).toMatchObject({ status: "both", generated: true });
        expect(listed?.drift ?? []).toEqual([]);
    });

    it("shows drift when it is not the shape a server writes", () => {
        const live = { ...companion(), roles: ["public"] };
        const listed = listPolicies([live], declared, "tasks").find((p) => p.policyname === live.policyname);
        expect(listed?.status).toBe("both");
        expect((listed?.drift ?? []).length).toBeGreaterThan(0);
    });

    it("is not listed as missing when the database has none", () => {
        const listed = listPolicies([], declared, "tasks");
        expect(listed.some((p) => p.roles.includes("rebase_admin_request"))).toBe(false);
    });
});
