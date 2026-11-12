import { defineTable, col } from "@rebasepro/server/schema";

export const categories = defineTable("categories", {
    columns: {
        id: col.integer().primaryKey().generatedByDefaultAsIdentity(),
        name: col.text().notNull(),
        slug: col.text().notNull(),
        description: col.text(),
        icon: col.text()
    },
    rls: "inherit"
});
