/**
 * The schema the typed-SDK probes are written against: a project's
 * `backend/schema`, as `defineTable` results.
 *
 * `database.types.ts` beside this file is the codegen's output for exactly
 * these tables, checked in so this program can read it without running
 * anything. `packages/codegen/test/baas-typecheck-fixture.test.ts` regenerates
 * it and fails when the two differ, so the probes always describe what the
 * generator emits today rather than what it emitted when they were written.
 * `../../registered-tables` types the same tables through `Register.tables`,
 * with no generated file at all.
 *
 * The shape is chosen for the seams the probes cross: a snake_case slug and a
 * kebab slug (accessor and wire name differ), every relation kind the SDK
 * writes, nullable columns, a date, a vector, enums, a never-writable column,
 * an API-hidden one and a closed foreign key.
 */
import { col, defineTable, rel } from "@rebasepro/types";

export const authors = defineTable("authors", {
    columns: {
        id: col.integer().primaryKey().identity(),
        name: col.text().notNull(),
        passwordHash: col.text().private(),
        salary: col.integer().access({ read: ["hr"], write: ["hr"] }),
        computed: col.text().readOnly(),
        createdAt: col.timestamptz().onCreateNow()
    },
    relations: {
        posts: rel.hasMany(() => posts, { foreignKey: "author_id" }),
        profile: rel.hasOne(() => profiles, { foreignKey: "author_id" }),
        // A single-hop to-one `via`: the target holds the key, so it is writable.
        profileVia: rel.via(() => profiles, { cardinality: "one", steps: [{ table: "profiles", on: { from: "id", to: "author_id" } }] })
    },
    rls: "admin-only"
});

export const profiles = defineTable("profiles", {
    columns: {
        id: col.integer().primaryKey().identity(),
        bio: col.text()
    },
    rls: "admin-only"
});

export const tags = defineTable("tags", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        label: col.text().notNull()
    },
    rls: "admin-only"
});

export const posts = defineTable("posts", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull(),
        subtitle: col.text(),
        status: col.enum(["draft", "published"]),
        views: col.integer(),
        tagsList: col.array(col.text()),
        embedding: col.vector(3),
        publishedAt: col.timestamptz()
    },
    relations: {
        author: rel.belongsTo(() => authors, { localKey: "author_id" }),
        tags: rel.manyToMany(() => tags, { pivot: { position: col.integer() } }),
        // A single-hop to-many `via`: one junction table holds the links.
        tagsVia: rel.via(() => tags, {
            cardinality: "many",
            steps: [
                { table: "posts_tags", on: { from: "id", to: "posts_id" } },
                { table: "tags", on: { from: "tags_id", to: "id" } }
            ]
        })
    },
    rls: "admin-only"
});

export const orderItems = defineTable("order_items", {
    columns: {
        id: col.integer().primaryKey().identity(),
        sku: col.text().notNull(),
        quantity: col.integer()
    },
    rls: "admin-only"
});

export const myNotes = defineTable("my_notes", {
    slug: "my-notes",
    columns: {
        id: col.text().primaryKey(),
        body: col.text()
    },
    rls: "admin-only"
});

/**
 * Every relation kind's write seam that `posts` does not already cross: a
 * required `belongsTo` (either spelling satisfies it), one whose key is hidden
 * from the API and one whose key nobody may write (the relation goes with its
 * key), and a multi-hop `via`, which is read-only.
 */
export const comments = defineTable("comments", {
    columns: {
        id: col.integer().primaryKey().identity(),
        body: col.text().notNull(),
        moderatorId: col.integer().column("moderator_id").private(),
        reviewerId: col.integer().column("reviewer_id").readOnly()
    },
    relations: {
        post: rel.belongsTo(() => posts, { localKey: "post_id", notNull: true }),
        moderator: rel.belongsTo(() => authors, { localKey: "moderator_id" }),
        reviewer: rel.belongsTo(() => authors, { localKey: "reviewer_id" }),
        postTags: rel.via(() => tags, {
            cardinality: "many",
            steps: [
                { table: "posts", on: { from: "post_id", to: "id" } },
                { table: "posts_tags", on: { from: "id", to: "posts_id" } },
                { table: "tags", on: { from: "tags_id", to: "id" } }
            ]
        })
    },
    rls: "admin-only"
});

export const tables = [authors, tags, posts, orderItems, myNotes, profiles, comments];
