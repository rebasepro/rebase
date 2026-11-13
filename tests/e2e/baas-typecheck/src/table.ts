/**
 * A `backend/schema` table with React nowhere in sight.
 *
 * This is the load-bearing half of the fixture. A BaaS or headless-CMS user
 * declares columns, validation, relations, RLS and hooks — everything the
 * database and the API care about — and none of it should require the admin
 * panel's type surface to exist.
 *
 * Every builder used here must stay in `@rebasepro/types`. If a future
 * refactor moves one into the admin layer, this file stops compiling, which is
 * the intent.
 */
import { col, defineTable, policy, rel, type InferInsert, type InferRow } from "@rebasepro/types";

export const authors = defineTable("authors", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        name: col.text().notNull()
    },
    rls: "admin-only"
});

export const posts = defineTable("posts", {
    schema: "public",
    description: "Blog posts",
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        // No `admin` block here, and that is the point — see admin_absent.ts,
        // which asserts that writing one in a BaaS project is a type error.
        title: col.text().notNull().validate({ max: 200, trim: true }),
        slug: col.text().unique(),
        status: col.enum(["draft", "published"]).default("draft"),
        views: col.integer().validate({ min: 0, integer: true }),
        published_at: col.timestamp({ withTimezone: true }).onUpdateNow(),
        // A server-side guarantee, not a UI hint — must be core.
        password_hash: col.text().private(),
        tags: col.text().array(),
        embedding: col.vector({ dimensions: 1536 }),
        author_id: col.uuid()
    },
    relations: {
        author: rel.belongsTo(() => authors, { localKey: "author_id", onDelete: "cascade" })
    },
    rls: [
        // Every rule flavour, since each compiles down a different path.
        { ownerField: "author_id" },
        { operation: "select", access: "public" },
        { operations: ["update", "delete"], roles: ["editor", "admin"] },
        {
            operation: "insert",
            condition: policy.compare(policy.field("status"), "eq", policy.literal("draft"))
        },
        {
            operation: "select",
            condition: policy.existsIn({
                table: "memberships",
                where: policy.compare(policy.field("user_id"), "eq", policy.authUid())
            })
        },
        { operation: "delete", using: "author_id = rebase.uid()" }
    ],
    hooks: {
        beforeSave: async ({ values, context, previousValues }) => {
            // `context` is RebaseCallContext — the both-sides context. Reaching
            // a UI controller off it here must not compile.
            await context.data.table("audit").create({
                what: values.title,
                was: previousValues?.title
            });
            return values;
        },
        // Rows are flat: the hook receives the row's `values`, not an Entity wrapper.
        afterRead: ({ values }) => values
    },
    history: true,
    metadata: { owner: "content-team" }
});

/** The row a read returns, inferred from the columns above. */
export type Post = InferRow<typeof posts>;

/** What a create accepts. */
export type NewPost = InferInsert<typeof posts>;
