/**
 * The one table the split-roles and provision-off e2e suites read and write.
 *
 * Public select so the data surface can be probed without a token — the point of
 * those tests is which PROCESS answers, not who may read.
 */
import { col, defineTable } from "@rebasepro/types";

export const notes = defineTable("notes", {
    table: "split_notes",
    schema: "public",
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text()
    },
    rls: [{ operation: "select", access: "public" }]
});
