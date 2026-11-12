import { defineTable, col } from "@rebasepro/server/schema";

export const tags = defineTable("tags", {
    columns: {
        id: col.integer().primaryKey().identity(),
        name: col.text().notNull()
    },
    rls: "inherit"
});
