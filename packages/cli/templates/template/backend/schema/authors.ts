import { defineTable, col } from "@rebasepro/server/schema";

export const authors = defineTable("authors", {
    columns: {
        id: col.integer().primaryKey().generatedByDefaultAsIdentity(),
        name: col.text().notNull(),
        email: col.text().notNull(),
        picture: col.storage({ path: "author_pictures/" })
    },
    rls: "inherit"
});
