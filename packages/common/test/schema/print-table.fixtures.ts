/**
 * Definitions the printer is proved against: every column builder and
 * modifier, every relation kind, every rls posture, a view of each kind and an
 * auth table. Started from the type-test seed of the schema contract and
 * extended until every member of `ColumnDef`, every relation option and every
 * table option is set somewhere.
 *
 * The set compiles (`compileTables(PRINT_FIXTURES, { defaultRls: DEFAULT_RLS })`),
 * so the descriptor round trip runs over it too.
 */
import { col, defineAuthTable, defineTable, defineView, json, rel } from "@rebasepro/types";
import type { DefaultRls } from "@rebasepro/types";

export const DEFAULT_RLS: DefaultRls = [{ operation: "select", access: "public" }];

/** Hook and transform bodies, as source and as the functions that source evaluates to. */
export const HOOK_SOURCES = {
    beforeSave: "({ values }) => values",
    afterRead: "({ values }) => values",
    beforeQuery: "() => undefined",
    afterDelete: "() => undefined"
} as const;

export const TRANSFORM_SOURCE = "{ beforeSave: ({ value }) => value.trim() }";
export const NESTED_TRANSFORM_SOURCE = "{ afterRead: ({ value }) => value }";

export const users = defineAuthTable("users", {
    schema: "rebase",
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique().validate({ email: true, lowercase: true, trim: true }),
        roles: col.array(col.text().oneOf(["admin", "editor"])).notNull().default([]),
        passwordHash: col.text().column("password_hash").private(),
        displayName: col.varchar(120).describe("What the user is called in the panel")
    },
    rls: "admin-only",
    auth: {
        personalKeys: true,
        roles: { editor: { name: "Editor", scopes: ["data:read", "data:write"] } },
        scopes: { "reports:run": { label: "Run reports" } }
    }
});

export const tags = defineTable("tags", {
    columns: { id: col.integer().primaryKey().identity(), name: col.text().notNull().unique() },
    rls: "inherit"
});

export const comments = defineTable("comments", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        body: col.text().notNull().transform({ beforeSave: ({ value }) => value.trim() }),
        postId: col.uuid().notNull(),
        createdAt: col.timestamptz().notNull().onCreateNow()
    },
    relations: {
        post: rel.belongsTo(() => posts, { localKey: "post_id", onDelete: "cascade" }),
        postAuthor: rel.via(() => users, {
            steps: [
                { table: "posts", on: { from: "post_id", to: "id" } },
                { table: "users", on: { from: "author_id", to: "id" } }
            ],
            cardinality: "one"
        })
    },
    rls: [
        { operation: "select", access: "public" },
        { operation: "insert", access: "authenticated", check: { body: "x" } },
        { operation: "update", using: "{post_id} IS NOT NULL", withCheck: "true" },
        { operation: "delete", withCheck: "false", roles: ["moderator"], mode: "restrictive" }
    ]
});

export const posts = defineTable("posts", {
    slug: "posts",
    schema: "public",
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull().validate({ min: 3, max: 200 }),
        slug: col.varchar(160).notNull().unique(),
        status: col.enum(["draft", "needs_review", "published", "archived"]).notNull().default("draft"),
        heroImage: col.storage({ path: "posts/heroes/", accept: ["image/*"], maxBytes: "10MB" }),
        gallery: col.storage({ path: "posts/gallery/", maxBytes: 1500 }).validate({ max: 300 }).multiple().notNull().validate({ maxItems: 12 }),
        embedding: col.vector(1536, { index: { method: "hnsw", metric: "cosine" } }),
        metadata: col.jsonb<{ seoTitle?: string; canonicalUrl?: string }>(),
        content: col.jsonb(json.array(json.oneOf({
            text: json.string(),
            image: json.storage({ path: "posts/content/" })
        }))),
        seo: col.jsonb(json.object({
            title: json.string().required().validate({ max: 60 }),
            noindex: json.boolean().default(false),
            keywords: json.array(json.string().oneOf(["a", "b"])).validate({ maxItems: 5 }),
            reviewedAt: json.date().onUpdateNow(),
            score: json.number().oneOf([1, 2, 3]).describe("Editorial score"),
            location: json.geopoint(),
            extra: json.unknown(),
            slugline: json.string().transform({ afterRead: ({ value }) => value })
        }, { additional: true })),
        blocks: col.json(json.oneOf({ quote: json.object({ by: json.string() }) }, { typeField: "kind", valueField: "data" })),
        priority: col.integer().oneOf([1, 2, 3]),
        publishDate: col.timestamptz(),
        orgId: col.uuid().notNull(),
        createdBy: col.uuid().onCreateUser(),
        updatedBy: col.uuid().onUpdateUser().readOnly(),
        createdAt: col.timestamptz().notNull().onCreateNow(),
        updatedAt: col.timestamptz().notNull().onUpdateNow(),
        deletedAt: col.timestamptz(),
        wordCount: col.integer().generatedAs("length(title)"),
        __order: col.text()
    },
    relations: {
        author: rel.belongsTo(() => users, { localKey: "author_id", notNull: true, onDelete: "restrict" }),
        tags: rel.manyToMany(() => tags, {
            through: "posts_tags",
            pivot: { addedBy: col.uuid(), sortOrder: col.integer().default(0) }
        }),
        comments: rel.hasMany(() => comments, { foreignKey: "post_id", orderBy: ["createdAt", "desc"] }),
        reviewer: rel.belongsTo(() => users, { localKey: "reviewer_id", unique: true, index: false, constraint: false, onUpdate: "cascade" })
    },
    rls: [
        { operation: "select", access: "public", condition: { status: "published" } },
        { operations: ["select", "insert", "update"], roles: ["editor"] },
        { operation: "delete", roles: ["admin"] }
    ],
    tenant: { field: "orgId", from: { claim: "org_id" } },
    softDelete: { field: "deletedAt" },
    history: true,
    search: { fields: ["title"], language: "english" },
    indexes: [{ columns: ["orgId", "status", { column: "publishDate", direction: "desc" }], reason: "admin list" }],
    hooks: {
        beforeSave: ({ values }) => values,
        afterRead: ({ values }) => values
    }
});

/** Every remaining column builder and modifier, on one table. */
export const kitchen = defineTable("kitchen_sink", {
    table: "kitchen",
    slug: "kitchen-sink",
    schema: "lab",
    database: "analytics",
    description: "Every column kind",
    columns: {
        tenantId: col.text().notNull(),
        code: col.char(2).primaryKey(),
        plain: col.varchar(),
        small: col.smallint().validate({ min: -5, max: 5, integer: true }),
        big: col.bigint().default(9007199254740991),
        tiny: col.smallserial(),
        counter: col.serial(),
        huge: col.bigserial(),
        ratio: col.real().validate({ moreThan: 0, lessThan: 1 }),
        precise: col.doublePrecision().validate({ positive: true }),
        money: col.numeric(10, 2).default(0),
        whole: col.numeric(5),
        anyNumber: col.numeric(),
        flag: col.boolean().default(true),
        day: col.date().validate({ min: new Date("2020-01-01T00:00:00.000Z"), max: "2030-12-31" }),
        at: col.time(),
        blob: col.bytea(),
        raw: col.json(),
        noIndex: col.vector(3, { index: false }),
        multi: col.vector(8, { index: { method: "hnsw", metric: ["cosine", "l2", "ip"], m: 16, efConstruction: 64 } }),
        flat: col.vector(8, { index: { method: "ivfflat", lists: 100 } }),
        place: col.geopoint(),
        mood: col.enum(["happy", "sad"], { name: "mood_type" }).default("happy"),
        shortId: col.text().defaultSql("gen_short_id()").unique(),
        legacy: col.text().dbDefault().column("LegacyCol"),
        phone: col.text().validate({ matches: /^\+?[0-9 ]+$/, matchesMessage: "digits only", requiredMessage: "needed" }),
        caseless: col.text().validate({ matches: "^[a-z]+$", matchesFlags: "i", length: 8, uppercase: true }),
        secret: col.text().private().access({ read: [], write: ["admin"] }),
        visible: col.text().access({ read: ["admin", "editor"] }).readOnly(),
        doc: col.storage({
            source: "media",
            path: "docs/{id}/",
            accept: ["application/pdf"],
            maxBytes: "2GB",
            imageResize: { maxWidth: 800, mode: "contain", format: "webp", quality: 80 },
            public: true,
            fileName: "{file}",
            metadata: { cacheControl: "max-age=60" },
            includeBucketUrl: false,
            storeUrl: true
        }),
        ids: col.array(col.uuid()).validate({ minItems: 1, uniqueItems: true }),
        moods: col.array(col.enum(["happy", "sad"], { name: "mood_type" })),
        scores: col.array(col.integer().oneOf([1, 2])),
        labels: col.array(col.text().transform({ afterRead: ({ value }) => value })),
        sorted: col.text().notNull().default("a").oneOf(["a", "b"]).validate({ min: 1 }).describe("A sort key")
    },
    rls: [
        { name: "owner", operation: "all", ownerField: "tenant_id" },
        {
            operation: "select",
            condition: {
                kind: "or",
                operands: [
                    { kind: "compare", op: "eq", left: { kind: "field", name: "tenant_id" }, right: { kind: "authUid" } },
                    { kind: "rolesOverlap", roles: ["auditor"] }
                ]
            }
        }
    ],
    defaultPolicies: false,
    tenant: { field: "tenantId", from: { claim: "tenant" }, bypassRoles: ["admin", "support"] },
    search: { fields: [{ path: "plain", weight: "A" }, "sorted"], language: "simple", unaccent: true },
    indexes: [
        { columns: ["plain"], unique: true, include: ["sorted"], where: { column: "flag", op: "=", value: true } },
        { columns: ["raw"], using: "gin" },
        { columns: ["day"], using: "brin", where: { and: [{ column: "day", op: "is not null" }, { column: "small", op: "in", value: [1, 2] }] } }
    ],
    strictWrites: false,
    metadata: { owner: "lab", tags: ["a", "b"], nested: { level: 2 } },
    hooks: { beforeQuery: () => undefined, afterDelete: () => undefined }
});

/** A composite key, `softDelete: true`, `hasOne`, a self-relation and a `manyToMany` with derived names. */
export const accounts = defineTable("accounts", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        deletedAt: col.timestamptz()
    },
    relations: {
        profile: rel.hasOne(() => profiles, { foreignKey: "account_id" }),
        parent: rel.belongsTo(() => accounts),
        friends: rel.manyToMany(() => accounts, { through: "account_friends", sourceKey: "account_id", targetKey: "friend_id", onDelete: "cascade", access: { read: ["admin", "member"], write: ["admin"] } }),
        tags: rel.manyToMany(() => tags, { private: true })
    },
    rls: [{ operation: "select", ownerField: "id" }],
    softDelete: true,
    history: false
});

export const profiles = defineTable("profiles", {
    columns: {
        accountId: col.uuid().primaryKey(),
        locale: col.char(5).primaryKey(),
        bio: col.text()
    },
    relations: {
        account: rel.belongsTo(() => accounts, { localKey: "account_id" })
    },
    rls: "admin-only"
});

export const publishedPosts = defineView("published_posts", {
    query: "select id, title from posts where status = 'published'",
    columns: { id: col.uuid().primaryKey(), title: col.text().notNull() },
    relations: { post: rel.belongsTo(() => posts, { localKey: "id" }) },
    description: "Posts anyone can read",
    hooks: { afterRead: ({ values }) => values }
});

export const postStats = defineView("post_stats", {
    slug: "post-stats",
    table: "post_stats_mv",
    schema: "reports",
    query: "select\n    status,\n    count(*) as total\nfrom posts\ngroup by status",
    materialized: true,
    roles: ["admin", "analyst"],
    columns: { status: col.text().primaryKey(), total: col.bigint().notNull() },
    indexes: [{ columns: ["total"] }],
    metadata: { refresh: "hourly" }
});

/** Every fixture, in an order `compileTables` accepts. */
export const PRINT_FIXTURES = [users, tags, comments, posts, kitchen, accounts, profiles, publishedPosts, postStats];

/** The transform sources the fixtures need, keyed by table name. */
export const FIXTURE_TRANSFORMS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    comments: { body: TRANSFORM_SOURCE },
    posts: { "seo.slugline": NESTED_TRANSFORM_SOURCE },
    kitchen_sink: { "labels[]": NESTED_TRANSFORM_SOURCE }
};

/** The hook sources the fixtures need, keyed by table name. */
export const FIXTURE_HOOKS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    posts: { beforeSave: HOOK_SOURCES.beforeSave, afterRead: HOOK_SOURCES.afterRead },
    kitchen_sink: { beforeQuery: HOOK_SOURCES.beforeQuery, afterDelete: HOOK_SOURCES.afterDelete },
    published_posts: { afterRead: HOOK_SOURCES.afterRead }
};
