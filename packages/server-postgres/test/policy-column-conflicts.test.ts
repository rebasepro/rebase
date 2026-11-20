/**
 * Which plan statements a policy blocks, and the SQL that puts a policy back
 * exactly. The transaction around them is exercised end to end in
 * `e2e/db-push-safety.test.ts` ("widens a column a policy reads").
 */
import { describeBlocked, dropPolicySql, findPolicyBlockedStatements, recreatePolicySql, type PolicyColumnDependency } from "../src/schema/policy-column-conflicts";

const deps: PolicyColumnDependency[] = [
    { schema: "public", table: "notes", column: "owner_id", policyOid: 11, policy: "notes_owner" },
    { schema: "public", table: "notes", column: "owner_id", policyOid: 12, policy: "notes_admin" },
    { schema: "public", table: "tags", column: "label", policyOid: 13, policy: "tags_read" }
];

describe("findPolicyBlockedStatements", () => {
    it("finds a retype of a column a policy reads, with every policy in its way", () => {
        const plan = `-- Planned Changes:\n-- Modify "notes" table\nALTER TABLE "public"."notes" ALTER COLUMN "owner_id" TYPE text, ALTER COLUMN "body" TYPE varchar(10);\n`;
        const blocked = findPolicyBlockedStatements(plan, deps);
        expect(blocked).toHaveLength(1);
        expect(blocked[0]).toMatchObject({
            schema: "public",
            table: "notes",
            columns: ["owner_id"],
            policies: [{ oid: 12, name: "notes_admin" }, { oid: 11, name: "notes_owner" }]
        });
        expect(blocked[0].statement).toBe(`ALTER TABLE "public"."notes" ALTER COLUMN "owner_id" TYPE text, ALTER COLUMN "body" TYPE varchar(10)`);
        expect(describeBlocked(blocked[0])).toBe("public.notes (owner_id): notes_admin, notes_owner");
    });

    it("leaves alone a retype no policy reads, a dropped column, and another schema's table", () => {
        const plan = [
            `ALTER TABLE "public"."notes" ALTER COLUMN "body" TYPE text;`,
            `ALTER TABLE "public"."tags" DROP COLUMN "label";`,
            `ALTER TABLE "other"."notes" ALTER COLUMN "owner_id" TYPE text;`
        ].join("\n");
        expect(findPolicyBlockedStatements(plan, deps)).toEqual([]);
    });
});

describe("recreatePolicySql", () => {
    it("puts a restrictive policy back with its roles, command, expressions and comment", () => {
        expect(recreatePolicySql({
            name: "notes_guard",
            schema: "public",
            table: "notes",
            command: "w",
            permissive: false,
            roles: ["rebase_user", "public"],
            using: "(owner_id = rebase.uid())",
            withCheck: "(owner_id = rebase.uid())",
            comment: "rebase:stamp 'v1'"
        })).toEqual([
            `CREATE POLICY "notes_guard" ON "public"."notes" AS RESTRICTIVE FOR UPDATE TO "rebase_user", PUBLIC USING ((owner_id = rebase.uid())) WITH CHECK ((owner_id = rebase.uid()))`,
            `COMMENT ON POLICY "notes_guard" ON "public"."notes" IS 'rebase:stamp ''v1'''`
        ]);
    });

    it("writes a permissive ALL policy with no WITH CHECK and no comment", () => {
        expect(recreatePolicySql({
            name: "n", schema: "public", table: "t", command: "*", permissive: true,
            roles: ["public"], using: "true", withCheck: null, comment: null
        })).toEqual([`CREATE POLICY "n" ON "public"."t" AS PERMISSIVE FOR ALL TO PUBLIC USING (true)`]);
        expect(dropPolicySql({ name: "n", schema: "public", table: "t" })).toBe(`DROP POLICY "n" ON "public"."t"`);
    });

    it("refuses a command it does not know rather than guess", () => {
        expect(() => recreatePolicySql({
            name: "n", schema: "public", table: "t", command: "x", permissive: true,
            roles: [], using: null, withCheck: null, comment: null
        })).toThrow(/cannot recreate/);
    });
});
