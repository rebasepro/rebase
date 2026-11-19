import { historicalChildren, unmanagedChildExcludes, type ExistingChild } from "../src/schema/unmanaged-child-excludes";

const child = (name: string, table = "tasks"): ExistingChild => ({ schema: "public", table, name });
const key = (...parts: string[]): string => JSON.stringify(parts);

describe("unmanaged children of a Ptah-selected table", () => {
    it("keeps custom policies, boot-only companions and user triggers outside the plan", () => {
        const excludes = unmanagedChildExcludes(
            [
                child("owner_reads"),
                child("tasks_select_a1b2c3d"),
                child("tasks_select_7654321"),
                child("tasks_select_a1b2c3d_ar_12345678"),
                child("external_read", "other")
            ],
            [child("tasks_updated_at_touch"), child("audit[v1]"), child("external_trg", "other")],
            ["public.tasks", "rebase.uid[type=function]"],
            new Set([key("public", "tasks", "owner_reads")]),
            new Set([key("public", "tasks", "tasks_updated_at_touch")])
        );

        expect(excludes).toEqual([
            "public.tasks.tasks_select_a1b2c3d_ar_12345678[type=policy]",
            "public.tasks.audit\\[v1\\][type=trigger]"
        ]);
    });

    it("keeps custom policy names while letting a superseded generated policy drop", () => {
        expect(unmanagedChildExcludes(
            [child("custom_read"), child("tasks_select_123abcd")],
            [],
            ["public.tasks"],
            new Set(),
            new Set()
        )).toEqual(["public.tasks.custom_read[type=policy]"]);
    });

    it("protects literal children in migrations not yet applied to the live target", () => {
        const history = historicalChildren(`
            CREATE POLICY "custom.read" ON "public"."tasks" FOR SELECT USING (true);
            CREATE POLICY "tasks_select_123abcd" ON "public"."tasks" FOR SELECT USING (true);
            CREATE TRIGGER "audit[1]" BEFORE UPDATE ON "public"."tasks"
              FOR EACH ROW EXECUTE FUNCTION public.audit();
            DROP POLICY "custom.read" ON "public"."tasks";
        `);
        expect(unmanagedChildExcludes(
            history.policies, history.triggers, ["public.tasks"], new Set(), new Set()
        )).toEqual([
            "public.tasks.custom?read[type=policy]",
            "public.tasks.audit\\[1\\][type=trigger]"
        ]);
    });
});
