import { defineTable, col, rel } from "@rebasepro/server/schema";
import { posts } from "./posts";

export const tags = defineTable("tags", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        name: col.text().notNull()
    },
    relations: {
        posts: rel.manyToMany(() => posts)
    },
    rls: "inherit",
    history: true
});
