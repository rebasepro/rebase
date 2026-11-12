// Mutually recursive by design: an author has posts, a post has an author. The
// reference is only dereferenced inside the `target: () =>` thunk below, which is
// the framework contract for exactly this, so module init order never matters.
// fallow-ignore-next-line circular-dependency

import { defineTable, col, rel } from "@rebasepro/server/schema";
import { posts } from "./posts";

export const authors = defineTable("authors", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        name: col.text().notNull().transform({
            beforeSave: ({ value }) => {
                return typeof value === "string" ? value.trim() : value;
            }
        }),
        email: col.text().notNull().transform({
            beforeSave: ({ value }) => {
                return typeof value === "string" ? value.trim() : value;
            }
        }),
        picture: col.storage({ path: "author_pictures/" }),
        bio: col.text().describe("Author biography in Markdown format"),
        twitter: col.text().describe("Twitter/X handle (e.g. @username)"),
        github: col.text().describe("GitHub username"),
        website: col.text().describe("Personal website URL"),
        userId: col.text().userId().describe("Link to a Rebase user")
    },
    relations: {
        posts: rel.hasMany(() => posts)
    },
    rls: "inherit",
    history: true
});
