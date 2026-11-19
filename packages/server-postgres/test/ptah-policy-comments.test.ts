import { policyCommentStatements } from "../src/schema/ptah-policy-comments";

describe("Ptah apply input preserves Rebase policy stamps", () => {
    it("keeps only current declared policy stamps", () => {
        const stamp = `rebase:${"a".repeat(64)}`;
        const plans = [{
            schema: "public",
            table: "tasks",
            policies: [{ name: "tasks_read" }]
        }];
        const comments = policyCommentStatements(plans, [
            {
                schema: "public",
                table: "tasks",
                name: "tasks_read",
                comment: stamp
            },
            {
                schema: "public",
                table: "tasks",
                name: "foreign_read",
                comment: stamp
            },
            {
                schema: "public",
                table: "other",
                name: "tasks_read",
                comment: stamp
            },
            {
                schema: "public",
                table: "tasks",
                name: "tasks_read",
                comment: "user note"
            }
        ]);

        expect(comments).toEqual([
            `COMMENT ON POLICY "tasks_read" ON "public"."tasks" IS '${stamp}';`
        ]);
    });
});
