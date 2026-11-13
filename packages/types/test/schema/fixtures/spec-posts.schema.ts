/**
 * The spec's §4.1 schema module (docs/plans/POSTGRES-FIRST.md), as a project's
 * `backend/schema/index.ts` would export it: tables, and a `defaultRls` that is
 * not a table.
 *
 * `spec-posts.database.ts` beside it is what `rebase generate-sdk` writes for
 * it (kept in step by `packages/codegen/test/spec-posts-fixture.test.ts`);
 * `database-of.test.ts` holds `DatabaseOf<typeof import("./spec-posts.schema")>`
 * to that file.
 */
import { col, defineAuthTable, defineTable, rel } from "../../../src/schema";
import type { DefaultRls } from "../../../src/schema";

export const defaultRls: DefaultRls = [{ operation: "select", access: "public" }];

export const users = defineAuthTable("users", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), email: col.text().notNull().unique() },
    rls: "admin-only"
});

export const tags = defineTable("tags", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), name: col.text().notNull() },
    rls: "inherit"
});

export const posts = defineTable("posts", {
    // Optional overrides (table defaults to "posts", schema defaults to "public", slug defaults to "posts")
    slug: "posts",
    schema: "public",

    columns: {
        id:          col.uuid().primaryKey().defaultRandom(),
        title:       col.text().notNull().validate({ min: 3, max: 200 }),
        slug:        col.varchar({ length: 160 }).notNull().unique(),
        status:      col.enum(["draft", "needs_review", "published", "archived"]).notNull().default("draft"),
        heroImage:   col.storage({ path: "posts/heroes/", accept: ["image/*"], maxBytes: "10MB" }),
        embedding:   col.vector({ dimensions: 1536, index: { method: "hnsw", metric: "cosine" } }),
        metadata:    col.jsonb().$type<{ seoTitle?: string; canonicalUrl?: string }>(),
        publishDate: col.timestamp({ withTimezone: true }),
        orgId:       col.uuid().notNull(),
        createdAt:   col.timestamp({ withTimezone: true }).notNull().onCreateNow(),
        updatedAt:   col.timestamp({ withTimezone: true }).notNull().onUpdateNow(),
        deletedAt:   col.timestamp({ withTimezone: true }),
        __order:     col.text(),
    },

    relations: {
        author: rel.belongsTo(() => users, {
            // Creates FK column `author_id` (or binds to an explicit column in `columns`) + btree index
            localKey: "author_id",
            notNull: true,
            onDelete: "restrict",
        }),
        tags: rel.manyToMany(() => tags, {
            through: "posts_tags",
            pivot: {
                addedBy: col.uuid(),
                sortOrder: col.integer().default(0),
            },
        }),
    },

    // MANDATORY: omitting `rls` is a compile-time error AND a boot-time error.
    rls: [
        { operation: "select", access: "public", condition: { status: "published" } },
        { operations: ["select", "insert", "update"], roles: ["editor"] },
        { operation: "delete", roles: ["admin"] },
    ],

    // Built-in Postgres capabilities (1:1 with current PostgresCollectionConfig)
    tenant:     { field: "orgId", from: { claim: "org_id" } },
    softDelete: { field: "deletedAt" },
    history:    true,
    search:     { fields: ["title"], language: "english" },
    indexes:    [{ columns: ["orgId", "status", "publishDate"] }],

    hooks: {
        beforeSave: ({ values, previousValues }) => {
            const merged = { ...previousValues, ...values };
            if (typeof merged.title === "string" && !merged.slug) {
                values.slug = merged.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
            }
            return values;
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        afterRead: ({ values, context }) => {
            // Full parity with current PII masking (`maskValues`) across REST, Realtime & MCP
            return values;
        },
    },
});
