import { col, defineTable } from "@rebasepro/types";

/** One valid table, so the only thing wrong is the sibling `resources.ts`. */
export const tags = defineTable("tags", {
    columns: {
        id: col.integer().primaryKey().identity(),
        name: col.text()
    },
    rls: "admin-only"
});
