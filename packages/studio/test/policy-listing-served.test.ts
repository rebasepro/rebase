import { describe, expect, it } from "@jest/globals";
import { col, defineTable } from "@rebasepro/types";
import type { PostgresPolicy, SecurityRule } from "@rebasepro/types";
import { getPolicyNamesForRule } from "@rebasepro/utils";
import { declaredPoliciesOf, listPolicies } from "../src/components/RLSEditor/policyListing";
import { EDITOR, servedTables } from "./helpers/servedTables";

/**
 * `listPolicies` compares the policies the server compiles (`rls.policies`)
 * with `pg_policies`. It compiles nothing: every declared row is the server's.
 */

const notes = defineTable("notes", {
    columns: { id: col.serial().primaryKey(), ownerId: col.text("owner_id") },
    rls: [{ name: "own_notes", operation: "select", ownerField: "ownerId" }]
});

const live = (policyname: string, fields: Partial<PostgresPolicy> = {}): PostgresPolicy => ({
    policyname, tablename: "notes", permissive: "PERMISSIVE", roles: ["public"], cmd: "SELECT", qual: "true", with_check: null, ...fields
});

describe("the policies of a served table", () => {
    const [served] = servedTables([notes]);
    const declared = declaredPoliciesOf(served.rls);

    it("carries the declared rule's index, and marks what Rebase injects as generated", () => {
        const listed = listPolicies([], declared, "notes");
        expect(listed.find(p => p.policyname === "own_notes")).toMatchObject({ status: "code_only", generated: false, rule: 0 });
        const baseline = listed.find(p => p.policyname === "notes_default_admin_read");
        expect(baseline).toMatchObject({ status: "code_only", generated: true });
        expect(baseline?.rule).toBeUndefined();
    });

    it("accepts the baseline written TO public by a server whose admin role is not live — and only that", () => {
        const fellBack = listPolicies([live("notes_default_admin_read")], declared, "notes").find(p => p.policyname === "notes_default_admin_read");
        expect(fellBack?.drift).toEqual([]);
        const elsewhere = listPolicies([live("notes_default_admin_read", { roles: ["rebase_user"] })], declared, "notes").find(p => p.policyname === "notes_default_admin_read");
        expect(elsewhere?.drift).toContain("roles");
    });

    it("lists only what the database holds when the server withheld the compiled policies", () => {
        const [redacted] = servedTables([notes], EDITOR);
        expect(redacted.rls.policies).toBeUndefined();
        expect(declaredPoliciesOf(redacted.rls)).toBeUndefined();
        expect(listPolicies([live("hand_written")], undefined, "notes").map(p => [p.policyname, p.status])).toEqual([["hand_written", "live"]]);
    });

    it("still lists a declared rule the server compiled no policy from", () => {
        const rule: SecurityRule = { operation: "select", using: "owner_id = rebase.uid()" };
        const [name] = getPolicyNamesForRule(rule, "notes");
        const listed = listPolicies([], { rules: [rule], policies: [] }, "notes");
        expect(listed).toEqual([expect.objectContaining({ policyname: name, status: "code_only", generated: false, rule: 0, qual: "owner_id = rebase.uid()" })]);
    });
});
