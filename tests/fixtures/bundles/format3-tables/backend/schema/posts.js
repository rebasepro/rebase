import { defineTable, col, rel, json } from "@rebasepro/server/schema";
import { authors } from "./authors.js";
import { tags } from "./tags.js";
export const posts = defineTable("posts", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull(),
        slug: col.text().notNull().unique().describe("URL-friendly identifier for this blog post. Left empty, it is derived from the title"),
        hero_image: col.storage({ path: "posts/hero/" }).describe("Header image displayed at the top of the blog post"),
        excerpt: col.text().validate({ max: 300 }).describe("Short summary displayed in previews and cards"),
        content: col.jsonb(json.array(json.oneOf({
            text: json.string(),
            image: json.storage({ path: "posts/content/" })
        }))).describe("Blog content as dynamic blocks of text and images"),
        status: col.enum(["draft", "needs_review", "published", "archived"]).notNull().default("draft"),
        publish_date: col.timestamp({ withTimezone: true }).describe("When this post was or will be published"),
        created_at: col.timestamp({ withTimezone: true }).onCreateNow(),
        updated_at: col.timestamp({ withTimezone: true }).onUpdateNow(),
        authorId: col.uuid(),
        __order: col.text().describe("Fractional index maintained by the Kanban board")
    },
    relations: {
        author: rel.belongsTo(() => authors),
        tags: rel.manyToMany(() => tags)
    },
    rls: "inherit",
    history: true,
    search: {
        language: "english",
        fields: [{ path: "title", weight: "A" }, { path: "excerpt", weight: "C" }, { path: "content", weight: "D" }]
    },
    indexes: [
        {
            columns: ["status", { column: "publish_date", direction: "desc" }],
            reason: "admin list: filter by status, newest first"
        },
        {
            columns: ["publish_date"],
            where: { column: "status", op: "=", value: "published" },
            reason: "public feed: published posts by date"
        },
        { columns: ["author"], reason: "an author's posts, and the ON DELETE cascade" }
    ],
    hooks: {
        beforeSave: ({ values, previousValues }) => {
            // An update sends only the fields that changed, so the rest are
            // read from the row as it was: a retitled post keeps its slug.
            const { title, slug } = { ...previousValues, ...values };
            if (typeof title === "string" && !slug) {
                values.slug = title
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/(^-|-$)/g, "");
            }
            return values;
        }
    }
});
