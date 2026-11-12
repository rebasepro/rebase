import { defineTable, col, rel } from "@rebasepro/server/schema";
import { authors } from "./authors";
import { tags } from "./tags";

export const posts = defineTable("posts", {
    columns: {
        id: col.integer().primaryKey().identity(),
        title: col.text().notNull(),
        content: col.text(),
        status: col.enum(["draft", "review", "published"]),
        authorId: col.integer()
    },
    relations: {
        // Binds to `authorId` (SQL `author_id`), the column declared above.
        author: rel.belongsTo(() => authors),
        // Creates the `posts_tags` junction table, with its own policies.
        tags: rel.manyToMany(() => tags)
    },
    // A post is readable once it is published, not before. With `"inherit"` it
    // would take `defaultRls` from index.ts, and every reader would see drafts —
    // anonymous ones too, once AUTH_REQUIRE=false serves a public site from this
    // backend.
    rls: [
        { operation: "select", using: "{status} = 'published'" },
        // Editors read drafts and posts in review; admins already read everything.
        { operation: "select", roles: ["editor"] },
        { operations: ["insert", "update", "delete"], roles: ["admin"] }
    ]
});
