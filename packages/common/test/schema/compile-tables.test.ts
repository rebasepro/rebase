import { describe, expect, it } from "@jest/globals";
import { col, defineAuthTable, defineTable, defineView, json, rel } from "@rebasepro/types";
import type { TableDescriptor } from "@rebasepro/types";

import { compileTable, compileTables, describeColumn } from "../../src/schema/compile-tables";

/**
 * `compileTables`: what a `defineTable` becomes. Every default applied, every
 * name derived, every relation resolved — the descriptor the backend runs on
 * and `GET /api/schema/tables` serves. The refusals are in
 * `compile-refusals.test.ts`; the parity of each derived name with today's
 * collection pipeline is in `compile-names.test.ts`.
 */

const users = defineAuthTable("users", {
    schema: "rebase",
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique(),
        passwordHash: col.text().column("password_hash"),
        roles: col.array(col.text()).notNull().default([])
    },
    rls: "admin-only",
    auth: { personalKeys: true, roles: { editor: { scopes: ["data:read"] } } }
});

const tags = defineTable("tags", {
    columns: { id: col.serial().primaryKey(), name: col.text().notNull() },
    rls: "inherit"
});

const comments = defineTable("comments", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        body: col.text().notNull(),
        postId: col.uuid().notNull()
    },
    // A two-way link (posts.comments ↔ comments.post) needs no annotation:
    // a relation thunk is a `TableThunk`.
    relations: { post: rel.belongsTo(() => posts) },
    rls: [{ operation: "select", access: "public" }]
});

/** The spec's §4.1 example, with every column kind it shows. */
const posts = defineTable("posts", {
    slug: "posts",
    schema: "public",
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull().validate({ min: 3, max: 200 }),
        slug: col.varchar(160).notNull().unique(),
        status: col.enum(["draft", "needs_review", "published", "archived"]).notNull().default("draft"),
        heroImage: col.storage({ path: "posts/heroes/", accept: ["image/*"], maxBytes: "10MB" }),
        embedding: col.vector(1536, { index: { method: "hnsw", metric: "cosine" } }),
        metadata: col.jsonb<{ seoTitle?: string; canonicalUrl?: string }>(),
        publishDate: col.timestamptz(),
        orgId: col.uuid().notNull(),
        createdAt: col.timestamptz().notNull().onCreateNow(),
        updatedAt: col.timestamptz().notNull().onUpdateNow(),
        deletedAt: col.timestamptz(),
        __order: col.text()
    },
    relations: {
        author: rel.belongsTo(() => users, { localKey: "author_id", notNull: true, onDelete: "restrict" }),
        tags: rel.manyToMany(() => tags, {
            through: "posts_tags",
            pivot: { addedBy: col.uuid(), sortOrder: col.integer().default(0) }
        }),
        comments: rel.hasMany(() => comments, { orderBy: ["createdAt", "desc"] })
    },
    rls: [
        { operation: "select", access: "public" },
        { operations: ["select", "insert", "update"], roles: ["editor"] },
        { operation: "delete", roles: ["admin"] }
    ],
    tenant: { field: "orgId", from: { claim: "org_id" } },
    softDelete: { field: "deletedAt" },
    history: true,
    search: { fields: ["title"], language: "english" },
    indexes: [{ columns: ["orgId", "status", "publishDate"] }],
    hooks: {
        beforeSave: ({ values }) => values,
        afterRead: ({ values }) => values
    }
});

const ALL = [users, tags, posts, comments];
const compileAll = (): TableDescriptor[] => compileTables(ALL, { defaultRls: "admin-only" });
const byName = (name: string): TableDescriptor => {
    const found = compileAll().find(t => t.name === name);
    if (!found) throw new Error(`no descriptor ${name}`);
    return found;
};

describe("compileTables — names", () => {
    it("derives table, slug and schema exactly as the pipeline does", () => {
        const [u, t, p] = compileAll();
        expect([u.name, u.slug, u.table, u.schema]).toEqual(["users", "users", "users", "rebase"]);
        expect([t.name, t.slug, t.table, t.schema]).toEqual(["tags", "tags", "tags", "public"]);
        expect([p.name, p.slug, p.table, p.schema]).toEqual(["posts", "posts", "posts", "public"]);
    });

    it("keeps `table` and `slug` overrides apart from the name", () => {
        const legacy = defineTable("blog_post", {
            table: "legacy_posts",
            slug: "posts",
            columns: { id: col.uuid().primaryKey() },
            rls: "admin-only"
        });
        const [d] = compileTables([legacy]);
        expect([d.name, d.slug, d.table, d.schema]).toEqual(["blog_post", "posts", "legacy_posts", "public"]);
    });

    it("snake-cases column keys, `.column()` wins, and `__order` becomes `order`", () => {
        const p = byName("posts");
        const columns = Object.fromEntries(p.columns.map(c => [c.key, c.column]));
        expect(columns).toMatchObject({
            heroImage: "hero_image",
            publishDate: "publish_date",
            orgId: "org_id",
            createdAt: "created_at",
            __order: "order"
        });
        expect(byName("users").columns.find(c => c.key === "passwordHash")?.column).toBe("password_hash");
    });

    it("lists the primary-key columns in declaration order", () => {
        const pair = defineTable("memberships", {
            columns: { userId: col.uuid().primaryKey(), orgId: col.uuid().primaryKey(), role: col.text() },
            rls: "admin-only"
        });
        const [d] = compileTables([pair]);
        expect(d.primaryKey).toEqual(["userId", "orgId"]);
        expect(d.columns.filter(c => c.primaryKey).map(c => c.key)).toEqual(["userId", "orgId"]);
    });

    it("keeps tables in input order and columns in physical order", () => {
        expect(compileAll().map(t => t.name)).toEqual(["users", "tags", "posts", "comments"]);
        expect(byName("posts").columns.map(c => c.key)).toEqual([
            "id", "title", "slug", "status", "heroImage", "embedding", "metadata", "publishDate", "orgId",
            "createdAt", "updatedAt", "deletedAt", "__order",
            // derived by `author`, after every declared column
            "authorId"
        ]);
    });
});

describe("compileTables — columns", () => {
    it("describes a column with only the flags that are set", () => {
        const p = byName("posts");
        const get = (key: string) => p.columns.find(c => c.key === key);
        expect(get("id")).toEqual({
            key: "id", column: "id", type: { kind: "uuid" }, nullable: false, primaryKey: true,
            default: { kind: "random-uuid" }
        });
        expect(get("title")).toEqual({
            key: "title", column: "title", type: { kind: "text" }, nullable: false, validate: { min: 3, max: 200 }
        });
        expect(get("slug")).toEqual({
            key: "slug", column: "slug", type: { kind: "varchar", length: 160 }, nullable: false, unique: true
        });
        expect(get("status")).toEqual({
            key: "status", column: "status",
            type: { kind: "enum", values: ["draft", "needs_review", "published", "archived"] },
            nullable: false, default: { kind: "literal", value: "draft" }
        });
        expect(get("heroImage")).toEqual({
            key: "heroImage", column: "hero_image", type: { kind: "text" }, nullable: true,
            storage: { path: "posts/heroes/", accept: ["image/*"], maxBytes: 10 * 1024 * 1024 }
        });
        expect(get("embedding")).toEqual({
            key: "embedding", column: "embedding", type: { kind: "vector", dimensions: 1536 }, nullable: true,
            vectorIndex: { method: "hnsw", metric: "cosine" }
        });
        expect(get("metadata")).toEqual({ key: "metadata", column: "metadata", type: { kind: "jsonb" }, nullable: true });
        expect(get("createdAt")).toEqual({
            key: "createdAt", column: "created_at", type: { kind: "timestamptz" }, nullable: false,
            stamp: { on: "create", value: "now" }
        });
        expect(get("updatedAt")?.stamp).toEqual({ on: "update", value: "now" });
    });

    it("carries every column flag the builders can set", () => {
        const table = defineTable("everything", {
            columns: {
                id: col.integer().primaryKey().identity(),
                computed: col.integer().generatedAs("id * 2"),
                locked: col.text().readOnly(),
                secret: col.text().private(),
                guarded: col.text().access({ read: ["admin"], write: [] }),
                author: col.uuid().onCreateUser(),
                note: col.text().describe("Free text").validate({ matches: /^a/i }),
                priority: col.integer().oneOf([1, 2, 3]),
                where: col.geopoint(),
                gallery: col.storage({ path: "g/", maxBytes: 1024 }).multiple(),
                labels: col.array(col.text().oneOf(["a", "b"]).validate({ max: 3 })).validate({ maxItems: 2 }),
                shaped: col.jsonb(json.object({
                    title: json.string().required().transform({ beforeSave: ({ value }) => value }),
                    at: json.date().onCreateNow(),
                    by: json.string().onUpdateUser()
                })),
                trimmed: col.text().transform({ beforeSave: ({ value }) => value.trim() }),
                legacy: col.text().dbDefault(),
                code: col.text().defaultSql("gen_short_id()"),
                noIndex: col.vector(3, { index: false })
            },
            rls: "admin-only"
        });
        const [d] = compileTables([table]);
        const get = (key: string) => d.columns.find(c => c.key === key);
        expect(get("id")?.default).toEqual({ kind: "identity" });
        expect(get("computed")).toMatchObject({ generated: { expression: "id * 2" }, readOnly: true });
        expect(get("locked")?.readOnly).toBe(true);
        expect(get("secret")?.private).toBe(true);
        expect(get("guarded")?.access).toEqual({ read: ["admin"], write: [] });
        expect(get("author")?.stamp).toEqual({ on: "create", value: "user" });
        expect(get("note")).toMatchObject({ description: "Free text", validate: { matches: "^a", matchesFlags: "i" } });
        expect(get("priority")?.oneOf).toEqual([1, 2, 3]);
        expect(get("where")).toMatchObject({ type: { kind: "jsonb" }, semantic: "geopoint" });
        expect(get("gallery")).toMatchObject({
            type: { kind: "array", of: { kind: "text" } },
            storage: { path: "g/", maxBytes: 1024 },
            element: { storage: { path: "g/", maxBytes: 1024 } }
        });
        expect(get("labels")).toMatchObject({
            type: { kind: "array", of: { kind: "text" } },
            validate: { maxItems: 2 },
            element: { oneOf: ["a", "b"], validate: { max: 3 } }
        });
        expect(get("shaped")?.json).toEqual({
            kind: "object",
            fields: { title: { kind: "string", required: true }, at: { kind: "date", stamp: "create" }, by: { kind: "string", stamp: "updateUser" } }
        });
        expect(get("trimmed")?.transforms).toEqual({ beforeSave: true });
        expect(get("legacy")?.default).toEqual({ kind: "database" });
        expect(get("code")?.default).toEqual({ kind: "sql", expression: "gen_short_id()" });
        expect(get("noIndex")?.vectorIndex).toBe(false);
    });

    it("serves nothing that is not JSON", () => {
        const round = JSON.parse(JSON.stringify(compileAll()));
        expect(round).toEqual(compileAll());
    });

    it("`describeColumn` leaves `unique` off a key column, as the planner does", () => {
        expect(describeColumn("id", col.uuid().primaryKey().unique().def, "id")).toEqual({
            key: "id", column: "id", type: { kind: "uuid" }, nullable: false, primaryKey: true
        });
    });
});

describe("compileTables — relations", () => {
    it("binds a belongsTo to the declared column whose SQL name is its localKey", () => {
        const c = byName("comments");
        expect(c.relations).toEqual([{
            name: "post", kind: "belongsTo", target: "posts", cardinality: "one",
            localKey: "post_id", localField: "postId", index: true, constraint: true
        }]);
        expect(c.columns.find(c => c.key === "postId")).toMatchObject({ foreignKeyOf: "post", nullable: false });
        expect(c.columns.find(c => c.key === "postId")?.derived).toBeUndefined();
    });

    it("derives a belongsTo column typed as the target's key, after the declared ones", () => {
        const p = byName("posts");
        expect(p.relations[0]).toEqual({
            name: "author", kind: "belongsTo", target: "users", cardinality: "one",
            localKey: "author_id", localField: "authorId", onDelete: "restrict", index: true, constraint: true
        });
        expect(p.columns.at(-1)).toEqual({
            key: "authorId", column: "author_id", type: { kind: "uuid" }, nullable: false,
            foreignKeyOf: "author", derived: true
        });
    });

    it("strips a serial key's sequence from the column pointing at it", () => {
        const counters = defineTable("counters", {
            columns: { id: col.uuid().primaryKey() },
            relations: { tag: rel.belongsTo(() => tags, { unique: true, index: false, constraint: false }) },
            rls: "admin-only"
        });
        const [, c] = compileTables([tags, counters], { defaultRls: "admin-only" });
        expect(c.columns.at(-1)).toEqual({
            key: "tagId", column: "tag_id", type: { kind: "integer" }, nullable: true, unique: true,
            foreignKeyOf: "tag", derived: true
        });
        expect(c.relations[0]).toMatchObject({ index: false, constraint: false });
    });

    it("resolves a many-to-many with its junction, keys and pivot", () => {
        const tagsRelation = byName("posts").relations.find(r => r.name === "tags");
        expect(tagsRelation).toEqual({
            name: "tags", kind: "manyToMany", target: "tags", cardinality: "many",
            through: {
                table: "posts_tags",
                sourceKey: "post_id",
                targetKey: "tag_id",
                pivot: [
                    { key: "addedBy", column: "added_by", type: { kind: "uuid" }, nullable: true },
                    { key: "sortOrder", column: "sort_order", type: { kind: "integer" }, nullable: true, default: { kind: "literal", value: 0 } }
                ]
            }
        });
    });

    it("defaults the junction to the sorted table names and the keys to the slug and relation", () => {
        const people = defineTable("people", {
            columns: { id: col.uuid().primaryKey() },
            relations: { favouriteTags: rel.manyToMany(() => tags, { onDelete: "restrict" }) },
            rls: "admin-only"
        });
        const [, p] = compileTables([tags, people], { defaultRls: "admin-only" });
        expect(p.relations[0]).toMatchObject({
            through: { table: "people_tags", sourceKey: "person_id", targetKey: "favourite_tag_id", pivot: [] },
            onDelete: "restrict"
        });
    });

    it("resolves hasOne / hasMany with the foreign key derived from the source slug", () => {
        expect(byName("posts").relations.find(r => r.name === "comments")).toEqual({
            name: "comments", kind: "hasMany", target: "comments", cardinality: "many",
            foreignKey: "post_id", orderBy: [["createdAt", "desc"]]
        });
        const profiles = defineTable("profiles", {
            columns: { id: col.uuid().primaryKey(), userId: col.uuid() },
            rls: "admin-only"
        });
        const accounts = defineTable("accounts", {
            slug: "app_accounts",
            columns: { id: col.uuid().primaryKey(), authUserId: col.uuid().unique() },
            relations: {
                profile: rel.hasOne(() => profiles),
                profiles: rel.hasMany(() => profiles, { foreignKey: "owner", sourceKey: "auth_user_id", orderBy: [["id", "asc"], ["userId", "desc", "last"]] })
            },
            rls: "admin-only"
        });
        const [, a] = compileTables([profiles, accounts]);
        expect(a.relations).toEqual([
            { name: "profile", kind: "hasOne", target: "profiles", cardinality: "one", foreignKey: "app_account_id" },
            {
                name: "profiles", kind: "hasMany", target: "profiles", cardinality: "many", foreignKey: "owner",
                sourceKey: "auth_user_id", orderBy: [["id", "asc"], ["userId", "desc", "last"]]
            }
        ]);
    });

    it("resolves a via with its steps and whether it is writable", () => {
        const orgs = defineTable("orgs", { columns: { id: col.uuid().primaryKey() }, rls: "admin-only" });
        const members = defineTable("members", {
            columns: { id: col.uuid().primaryKey() },
            relations: {
                orgsThrough: rel.via(() => orgs, {
                    steps: [
                        { table: "memberships", on: { from: "id", to: "member_id" } },
                        { table: "orgs", on: { from: "org_id", to: "id" } }
                    ]
                }),
                deep: rel.via(() => orgs, {
                    cardinality: "one",
                    steps: [
                        { table: "a", on: { from: "id", to: "m" } },
                        { table: "orgs", on: { from: "o", to: "id" } }
                    ]
                })
            },
            rls: "admin-only"
        });
        const [, m] = compileTables([orgs, members]);
        expect(m.relations).toEqual([
            {
                name: "orgsThrough", kind: "via", target: "orgs", cardinality: "many", writable: true,
                steps: [
                    { table: "memberships", on: { from: "id", to: "member_id" } },
                    { table: "orgs", on: { from: "org_id", to: "id" } }
                ]
            },
            {
                name: "deep", kind: "via", target: "orgs", cardinality: "one", writable: false,
                steps: [
                    { table: "a", on: { from: "id", to: "m" } },
                    { table: "orgs", on: { from: "o", to: "id" } }
                ]
            }
        ]);
    });

    it("resolves a target handed back as a module namespace", () => {
        // What a cycle transpiled to CommonJS hands a thunk: `{ __esModule, default }`.
        const holder: { namespace: unknown } = { namespace: tags };
        Object.assign(holder, { namespace: { __esModule: true, default: tags } });
        const linked = defineTable("linked", {
            columns: { id: col.uuid().primaryKey() },
            relations: { tag: rel.belongsTo(() => holder.namespace) },
            rls: "admin-only"
        });
        const [, l] = compileTables([tags, linked], { defaultRls: "admin-only" });
        expect(l.relations[0]).toMatchObject({ target: "tags", localKey: "tag_id" });
    });

    it("takes no constraint for a belongsTo into a view", () => {
        const active = defineView("active_tags", {
            query: "select id from tags",
            columns: { id: col.integer().primaryKey() }
        });
        const notes = defineTable("notes", {
            columns: { id: col.uuid().primaryKey() },
            relations: { tag: rel.belongsTo(() => active) },
            rls: "admin-only"
        });
        const [, n] = compileTables([active, notes]);
        expect(n.relations[0]).toMatchObject({ kind: "belongsTo", target: "active_tags", constraint: false });
        expect(n.columns.at(-1)).toMatchObject({ column: "tag_id", type: { kind: "integer" } });
    });

    it("carries field-level access and `private` on every kind of relation", () => {
        const owners = defineTable("owners", { columns: { id: col.uuid().primaryKey() }, rls: "admin-only" });
        const things = defineTable("things", {
            columns: { id: col.uuid().primaryKey() },
            relations: {
                owner: rel.belongsTo(() => owners, { access: { read: ["admin", "editor"], write: ["admin"] } }),
                twin: rel.hasOne(() => owners, { foreignKey: "thing_id", private: true }),
                many: rel.hasMany(() => owners, { foreignKey: "thing_ref", access: { write: [] } }),
                linked: rel.manyToMany(() => owners, { access: { read: ["admin"] } }),
                far: rel.via(() => owners, { steps: [{ table: "owners", on: { from: "id", to: "id" } }], private: true }),
                plain: rel.belongsTo(() => owners)
            },
            rls: "admin-only"
        });
        const [, t] = compileTables([owners, things]);
        const byName = Object.fromEntries(t.relations.map(r => [r.name, r]));
        expect(byName.owner).toMatchObject({ access: { read: ["admin", "editor"], write: ["admin"] } });
        expect(byName.owner.private).toBeUndefined();
        expect(byName.twin).toMatchObject({ private: true });
        expect(byName.twin.access).toBeUndefined();
        expect(byName.many).toMatchObject({ access: { write: [] } });
        expect(byName.linked).toMatchObject({ access: { read: ["admin"] } });
        expect(byName.far).toMatchObject({ private: true });
        expect("access" in byName.plain || "private" in byName.plain).toBe(false);
    });

    it("types a column pointing at an enum key with the key table's enum type", () => {
        const codes = defineTable("codes", {
            columns: { code: col.enum(["a", "b"]).primaryKey() },
            rls: "admin-only"
        });
        const uses = defineTable("uses", {
            columns: { id: col.uuid().primaryKey() },
            relations: { code: rel.belongsTo(() => codes) },
            rls: "admin-only"
        });
        const [, u] = compileTables([codes, uses]);
        expect(u.columns.at(-1)?.type).toEqual({ kind: "enum", values: ["a", "b"], name: "codes_code" });
    });
});

describe("compileTables — rls", () => {
    it("resolves \"admin-only\" to the baseline alone", () => {
        expect(byName("users").rls).toEqual({ posture: "admin-only", rules: [], defaultPolicies: true });
    });

    it("carries a rule list verbatim — the same objects, in the same order", () => {
        const rules = byName("posts").rls;
        expect(rules.posture).toBe("rules");
        expect(rules.defaultPolicies).toBe(true);
        expect(rules.rules).toEqual(posts.config.rls);
        const declared = posts.config.rls;
        if (!Array.isArray(declared)) throw new Error("posts declares rules");
        rules.rules.forEach((rule, index) => expect(rule).toBe(declared[index]));
    });

    it("switches the admin baseline off with `defaultPolicies: false`", () => {
        const open = defineTable("open", {
            columns: { id: col.uuid().primaryKey() },
            rls: [{ operation: "select", access: "public" }],
            defaultPolicies: false
        });
        expect(compileTables([open])[0].rls).toEqual({
            posture: "rules", rules: [{ operation: "select", access: "public" }], defaultPolicies: false
        });
    });

    it("resolves \"inherit\" to the project's defaultRls, marked inherited", () => {
        expect(byName("tags").rls).toEqual({ posture: "admin-only", rules: [], defaultPolicies: true, inherited: true });
        const defaultRls = [{ operation: "select", roles: ["viewer"] }] as const;
        const [t] = compileTables([tags], { defaultRls });
        expect(t.rls).toEqual({ posture: "rules", rules: [{ operation: "select", roles: ["viewer"] }], defaultPolicies: true, inherited: true });
        expect(t.rls.rules[0]).toBe(defaultRls[0]);
    });
});

describe("compileTables — table options", () => {
    it("carries tenant, softDelete, history, search, indexes, hooks and description", () => {
        const p = byName("posts");
        expect(p.kind).toBe("table");
        expect(p.tenant).toEqual({ field: "orgId", from: { claim: "org_id" } });
        expect(p.softDelete).toEqual({ field: "deletedAt" });
        expect(p.history).toBe(true);
        expect(p.search).toEqual({ fields: ["title"], language: "english" });
        expect(p.indexes).toEqual([{ columns: ["orgId", "status", "publishDate"] }]);
        expect(p.hooks).toEqual({ beforeSave: true, afterRead: true });
        expect(p.strictWrites).toBeUndefined();
        expect(p.view).toBeUndefined();
        expect(p.auth).toBeUndefined();
    });

    it("makes the tenant column NOT NULL, as the planner does", () => {
        const scoped = defineTable("scoped", {
            columns: { id: col.uuid().primaryKey(), orgId: col.uuid() },
            rls: "admin-only",
            tenant: { field: "orgId", from: { claim: "org_id" }, bypassRoles: ["support"] }
        });
        const [s] = compileTables([scoped]);
        expect(s.columns.find(c => c.key === "orgId")?.nullable).toBe(false);
        expect(s.tenant).toEqual({ field: "orgId", from: { claim: "org_id" }, bypassRoles: ["support"] });
    });

    it("scopes a tenant through a belongsTo, naming its foreign-key column", () => {
        const orgs = defineTable("orgs", { columns: { id: col.uuid().primaryKey() }, rls: "admin-only" });
        const projects = defineTable("projects", {
            columns: { id: col.uuid().primaryKey() },
            relations: { org: rel.belongsTo(() => orgs) },
            rls: "admin-only",
            tenant: { field: "id", from: { membership: { collection: "members", userField: "user_id", tenantField: "org_id" } } }
        });
        const viaRelation = { ...projects, config: { ...projects.config, tenant: { field: "org", from: { claim: "org_id" } } } };
        const [, p] = compileTables([orgs, viaRelation]);
        expect(p.tenant?.field).toBe("orgId");
        expect(p.columns.find(c => c.key === "orgId")?.nullable).toBe(false);
    });

    it("normalizes `softDelete: true` to the legacy default field", () => {
        const trash = defineTable("trash", {
            columns: { id: col.uuid().primaryKey(), deletedAt: col.timestamptz() },
            rls: "admin-only",
            softDelete: true
        });
        expect(compileTables([trash])[0].softDelete).toEqual({ field: "deletedAt" });
        const trashObject = defineTable("trash_object", {
            columns: { id: col.uuid().primaryKey(), deletedAt: col.timestamptz() },
            rls: "admin-only",
            softDelete: {}
        });
        expect(compileTables([trashObject])[0].softDelete).toEqual({ field: "deletedAt" });
        const off = defineTable("off", { columns: { id: col.uuid().primaryKey() }, rls: "admin-only", softDelete: false });
        expect(compileTables([off])[0].softDelete).toBeUndefined();
    });

    it("carries database, description, strictWrites and metadata", () => {
        const t = defineTable("analytics", {
            database: "warehouse",
            description: "Page views",
            strictWrites: false,
            metadata: { owner: "growth" },
            columns: { id: col.uuid().primaryKey() },
            rls: "admin-only"
        });
        const [d] = compileTables([t]);
        expect(d).toMatchObject({ database: "warehouse", description: "Page views", strictWrites: false, metadata: { owner: "growth" } });
        const onDefault = defineTable("on_default", { database: "(default)", columns: { id: col.uuid().primaryKey() }, rls: "admin-only" });
        expect(compileTables([onDefault])[0].database).toBeUndefined();
    });

    it("describes the auth table: its declared columns, its serializable options, secrets made private", () => {
        const u = byName("users");
        expect(u.auth).toEqual({ personalKeys: true, roles: { editor: { scopes: ["data:read"] } } });
        expect(u.columns.map(c => c.key)).toEqual(["id", "email", "passwordHash", "roles"]);
        expect(u.columns.find(c => c.key === "passwordHash")?.private).toBe(true);
        expect(u.columns.find(c => c.key === "email")?.private).toBeUndefined();
    });

    it("says which user-lifecycle hooks the auth table declares, never their code", () => {
        const members = defineAuthTable("members", {
            columns: { id: col.uuid().primaryKey() },
            rls: "admin-only",
            auth: { onCreateUser: async () => ({}) }
        });
        const both = defineAuthTable("people", {
            columns: { id: col.uuid().primaryKey() },
            rls: "admin-only",
            auth: { onCreateUser: async () => ({}), onResetPassword: async () => ({}) }
        });
        expect(compileTables([members])[0].auth).toEqual({ hooks: { onCreateUser: true } });
        expect(compileTables([both])[0].auth).toEqual({ hooks: { onCreateUser: true, onResetPassword: true } });
        expect(JSON.parse(JSON.stringify(compileTables([both])[0].auth))).toEqual({ hooks: { onCreateUser: true, onResetPassword: true } });
        // None declared: no `hooks` key.
        expect(byName("users").auth).not.toHaveProperty("hooks");
    });

    it("makes a secret private by its SQL column too, and only on the auth table", () => {
        const store = defineAuthTable("accounts", {
            columns: { id: col.uuid().primaryKey(), token: col.text().column("email_verification_token") },
            rls: "admin-only"
        });
        expect(compileTables([store])[0].columns.find(c => c.key === "token")?.private).toBe(true);
        const crm = defineTable("crm_users", {
            columns: { id: col.uuid().primaryKey(), passwordHash: col.text() },
            rls: "admin-only"
        });
        expect(compileTables([crm])[0].columns.find(c => c.key === "passwordHash")?.private).toBeUndefined();
    });
});

describe("compileTables — views", () => {
    it("describes a plain view: security_invoker, no policies of its own", () => {
        const published = defineView("published_posts", {
            query: "select id, title from posts where status = 'published'",
            columns: { id: col.uuid().primaryKey(), title: col.text().notNull() },
            hooks: { afterRead: ({ values }) => values }
        });
        const [v] = compileTables([published]);
        expect(v).toEqual({
            name: "published_posts", slug: "published_posts", table: "published_posts", schema: "public",
            kind: "view",
            columns: [
                { key: "id", column: "id", type: { kind: "uuid" }, nullable: false, primaryKey: true },
                { key: "title", column: "title", type: { kind: "text" }, nullable: false }
            ],
            primaryKey: ["id"],
            relations: [],
            rls: { posture: "view", rules: [], defaultPolicies: false },
            view: { materialized: false, query: "select id, title from posts where status = 'published'" },
            hooks: { afterRead: true }
        });
    });

    it("gates a materialized view by roles, `admin` when omitted", () => {
        const stats = defineView("stats", {
            query: "select 1 as id",
            materialized: true,
            columns: { id: col.integer().primaryKey() },
            indexes: [{ columns: ["id"] }]
        });
        const gated = defineView("gated", {
            query: "select 1 as id",
            materialized: true,
            roles: ["analyst"],
            slug: "gated_stats",
            columns: { id: col.integer().primaryKey() }
        });
        const [s, g] = compileTables([stats, gated]);
        expect(s.view).toEqual({ materialized: true, roles: ["admin"], query: "select 1 as id" });
        expect(s.indexes).toEqual([{ columns: ["id"] }]);
        expect(g.view?.roles).toEqual(["analyst"]);
        expect(g.slug).toBe("gated_stats");
        // Materialized or not, a view's rls is its own posture: no rules, no baseline.
        expect(s.rls).toEqual({ posture: "view", rules: [], defaultPolicies: false });
        expect(g.rls).toEqual({ posture: "view", rules: [], defaultPolicies: false });
    });
});

describe("compileTables — purity", () => {
    it("is deterministic: the same input compiles to the same output", () => {
        expect(compileAll()).toEqual(compileAll());
    });

    it("does not mutate the definitions", () => {
        const before = JSON.stringify(ALL.map(t => t.config.columns));
        compileAll();
        expect(JSON.stringify(ALL.map(t => t.config.columns))).toBe(before);
    });
});

describe("compileTable", () => {
    it("compiles one definition with a caller's resolver", () => {
        const { descriptor, problems } = compileTable(comments, () => ({ ok: true, target: posts }));
        expect(problems).toEqual([]);
        expect(descriptor?.relations[0]).toMatchObject({ kind: "belongsTo", target: "posts", localKey: "post_id" });
    });

    it("returns problems instead of throwing", () => {
        const { problems } = compileTable(comments, () => ({ ok: false, message: "is elsewhere." }));
        expect(problems).toEqual([{ table: "comments", key: "post", message: "the relation is elsewhere." }]);
    });

    it("reports a value that is not a definition", () => {
        const { descriptor, problems } = compileTable(
            // A JavaScript caller can hand over anything.
            JSON.parse("{\"brand\":\"nope\"}"),
            () => ({ ok: false, message: "unused" })
        );
        expect(descriptor).toBeUndefined();
        expect(problems[0].message).toMatch(/is not a `defineTable/);
    });
});
