import { describe, expect, it } from "vitest";

import { policy, snapshot, table } from "../../test/fixtures/snapshot";
import { unqualifiedColumnInSubquery } from "./unqualified-column-in-subquery";

/**
 * The schema these tests reason about is the one the bug actually shipped on:
 * `organizations` and `org_members` both have an `id`, and `org_members` also
 * has `organization_id` and `user_id`.
 */
const org = (using: string | null, withCheck: string | null = null) =>
    snapshot({
        relations: [
            table("public", "organizations", { rlsEnabled: true, columns: ["id", "name", "user_id"] }),
            table("public", "org_members", {
                rlsEnabled: true,
                columns: ["id", "organization_id", "user_id"]
            })
        ],
        policies: [policy("public", "organizations", "org_read", { using, withCheck })]
    });

const run = (using: string | null, withCheck: string | null = null) =>
    unqualifiedColumnInSubquery.run(org(using, withCheck));

describe("unqualified-column-in-subquery", () => {
    it("finds the bare `id` that binds to the inner table", () => {
        const findings = run(
            "(EXISTS ( SELECT 1 FROM org_members WHERE ((org_members.user_id = auth.uid()) AND (organization_id = id))))"
        );

        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("high");
        expect(findings[0].confidence).toBe("heuristic");
        expect(findings[0].target.column).toBe("id");
        expect(findings[0].title).toContain("public.org_members");
        expect(findings[0].detail).toContain("re-rendering");
    });

    it("words the finding as a question, not an accusation", () => {
        const [f] = run(
            "(EXISTS ( SELECT 1 FROM org_members WHERE (organization_id = id)))"
        );

        expect(f.title).toMatch(/\?$/);
    });

    it("does NOT fire when every reference is qualified through an alias", () => {
        expect(
            run(
                "(EXISTS ( SELECT 1 FROM org_members m WHERE ((m.user_id = auth.uid()) AND (m.organization_id = organizations.id))))"
            )
        ).toEqual([]);
    });

    it("does NOT fire on a bare column compared against a function", () => {
        // `user_id` exists on both relations, but binding to org_members is
        // exactly what the author meant here.
        expect(
            run("(EXISTS ( SELECT 1 FROM org_members WHERE (user_id = auth.uid())))")
        ).toEqual([]);
    });

    it("does NOT fire on a bare column compared against a literal", () => {
        expect(run("(EXISTS ( SELECT 1 FROM org_members WHERE (id = 'x'::uuid)))")).toEqual([]);
    });

    it("does NOT fire on a bare name in the select list", () => {
        expect(
            run("(id IN ( SELECT organization_id FROM org_members WHERE (org_members.user_id = auth.uid())))")
        ).toEqual([]);
    });

    it("does NOT fire on a column that only exists on one side", () => {
        expect(
            run("(EXISTS ( SELECT 1 FROM org_members WHERE (organization_id = organizations.id)))")
        ).toEqual([]);
    });

    it("does NOT fire on a subquery over the policy's own table", () => {
        expect(run("(EXISTS ( SELECT 1 FROM organizations WHERE (id = id)))")).toEqual([]);
    });

    it("does NOT fire when the inner relation is not in the snapshot", () => {
        expect(run("(EXISTS ( SELECT 1 FROM some_other_db.thing WHERE (id = id)))")).toEqual([]);
    });

    it("is not fooled by the word EXISTS inside a string literal", () => {
        expect(
            run("(note = 'EXISTS ( SELECT 1 FROM org_members WHERE organization_id = id)')")
        ).toEqual([]);
    });

    it("is not fooled by dollar-quoted text", () => {
        expect(
            run("(note = $q$EXISTS (SELECT 1 FROM org_members WHERE organization_id = id)$q$)")
        ).toEqual([]);
    });

    it("descends into nested EXISTS and attributes each to its own FROM", () => {
        const findings = run(
            "(EXISTS ( SELECT 1 FROM org_members WHERE ((org_members.user_id = auth.uid()) " +
                "AND (EXISTS ( SELECT 1 FROM org_members WHERE (organization_id = id))))))"
        );

        expect(findings).toHaveLength(1);
        expect(findings[0].target.column).toBe("id");
    });

    it("scans WITH CHECK as well as USING", () => {
        const findings = run(null, "(EXISTS ( SELECT 1 FROM org_members WHERE (organization_id = id)))");

        expect(findings).toHaveLength(1);
        expect(findings[0].detail).toContain("WITH CHECK");
    });

    it("reports each ambiguous column once per policy, not once per mention", () => {
        const findings = run(
            "(EXISTS ( SELECT 1 FROM org_members WHERE ((organization_id = id) OR (id = organization_id))))"
        );

        expect(findings).toHaveLength(1);
    });

    it("stays quiet on a policy with no subquery at all", () => {
        expect(run("(user_id = auth.uid())")).toEqual([]);
    });
});
