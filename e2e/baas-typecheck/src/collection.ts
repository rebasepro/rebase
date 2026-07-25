/**
 * A collection file with React nowhere in sight.
 *
 * This is the load-bearing half of the fixture. A BaaS or headless-CMS user
 * declares schema, validation, relations, RLS and callbacks — everything the
 * database and the API care about — and none of it should require the admin
 * panel's type surface to exist.
 *
 * Every field used here must stay in `@rebasepro/types`. If a future refactor
 * moves one into the admin layer, this file stops compiling, which is the
 * intent.
 */
import { policy, type PostgresCollectionConfig, type InferEntityType } from "@rebasepro/types";

const properties = {
    title: {
        type: "string",
        name: "Title",
        validation: { required: true, max: 200, trim: true },
        // Property-level presentation stays available and stays React-free:
        // `ui.Field` is a ComponentRef, which is structural, not React.ComponentType.
        ui: { columnWidth: 240, Field: "../../frontend/src/TitleField" }
    },
    slug: {
        type: "string",
        name: "Slug",
        isId: "cuid",
        validation: { unique: true }
    },
    status: {
        type: "string",
        name: "Status",
        enum: {
            draft: "Draft",
            published: { id: "published", label: "Published", color: "green" }
        },
        defaultValue: "draft"
    },
    views: {
        type: "number",
        name: "Views",
        columnType: "integer",
        validation: { min: 0, integer: true }
    },
    published_at: {
        type: "date",
        name: "Published at",
        mode: "date_time",
        autoValue: "on_update"
    },
    password_hash: {
        type: "string",
        name: "Password hash",
        // A server-side guarantee, not a UI hint — must be core.
        excludeFromApi: true
    },
    tags: {
        type: "array",
        name: "Tags",
        columnType: "text[]",
        of: { type: "string", name: "Tag" }
    },
    embedding: {
        type: "vector",
        name: "Embedding",
        dimensions: 1536
    }
} as const satisfies PostgresCollectionConfig["properties"];

export type Post = InferEntityType<typeof properties>;

const posts: PostgresCollectionConfig<Post> = {
    slug: "posts",
    name: "Posts",
    singularName: "Post",
    description: "Blog posts",
    table: "posts",
    schema: "public",
    properties,

    relations: [
        {
            relationName: "author",
            target: () => "authors",
            cardinality: "one",
            localKey: "author_id",
            onDelete: "cascade"
        }
    ],

    securityRules: [
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
                collection: "memberships",
                where: policy.compare(policy.field("user_id"), "eq", policy.authUid())
            })
        },
        { operation: "delete", using: "author_id = auth.uid()" }
    ],

    callbacks: {
        beforeSave: async ({ values, context, previousValues }) => {
            // `context` is RebaseCallContext — the both-sides context. Reaching
            // a UI controller off it here must not compile.
            await context.data.collection("audit").create({
                what: values.title,
                was: previousValues?.title
            });
            return values;
        },
        // Rows are flat: the hook receives `row`, not an Entity wrapper.
        afterRead: ({ row }) => row
    },

    history: true,
    strictWrites: true,
    metadata: { owner: "content-team" }
};

export default posts;
