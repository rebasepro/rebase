/**
 * The spec's §4.1 tables, compiled by `compileTables` and projected: the whole
 * path from `defineTable` to the panel's collection, with no frontend config.
 */
import { describe, expect, it } from "@jest/globals";
import type { Entity, SecurityOperation, User } from "@rebasepro/types";
import { col, defineAuthTable, defineTable, rel } from "@rebasepro/types";
import { compileTables, getEntityChildViews, resolveCollectionRelations } from "@rebasepro/common";
import { checkOperation } from "@rebasepro/cms-types";
import { getDefaultFieldId } from "../../src/components/field_ids";
import { collectionsFromTables } from "../../src/tables";

const users = defineAuthTable("users", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique().validate({ email: true }),
        displayName: col.text()
    },
    auth: { roles: { admin: { scopes: [] }, editor: { scopes: [] } } },
    rls: "admin-only"
});

const tags = defineTable("tags", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        name: col.text().notNull()
    },
    rls: [{ operation: "select", access: "public" }, { operations: ["insert", "update", "delete"], roles: ["editor"] }]
});

const posts = defineTable("posts", {
    slug: "posts",
    schema: "public",
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull().validate({ min: 3, max: 200 }),
        slug: col.varchar({ length: 160 }).notNull().unique(),
        status: col.enum(["draft", "needs_review", "published", "archived"]).notNull().default("draft"),
        heroImage: col.storage({ path: "posts/heroes/", accept: ["image/*"], maxBytes: "10MB" }),
        embedding: col.vector({ dimensions: 1536, index: { method: "hnsw", metric: "cosine" } }),
        metadata: col.jsonb().$type<{ seoTitle?: string; canonicalUrl?: string }>(),
        publishDate: col.timestamp({ withTimezone: true }),
        orgId: col.uuid().notNull(),
        createdAt: col.timestamp({ withTimezone: true }).notNull().onCreateNow(),
        updatedAt: col.timestamp({ withTimezone: true }).notNull().onUpdateNow(),
        deletedAt: col.timestamp({ withTimezone: true }),
        __order: col.text()
    },
    relations: {
        author: rel.belongsTo(() => users, { localKey: "author_id", notNull: true, onDelete: "restrict" }),
        tags: rel.manyToMany(() => tags, {
            through: "posts_tags",
            pivot: {
                addedBy: col.uuid(),
                sortOrder: col.integer().default(0)
            }
        })
    },
    rls: [
        { operation: "select", access: "public", condition: { kind: "compare", op: "eq", left: { kind: "field", name: "status" }, right: { kind: "literal", value: "published" } } },
        { operations: ["select", "insert", "update"], roles: ["editor"] },
        { operation: "delete", roles: ["admin"] }
    ],
    tenant: { field: "orgId", from: { claim: "org_id" } },
    softDelete: { field: "deletedAt" },
    history: true,
    search: { fields: ["title"], language: "english" }
});

const [projectedPosts, projectedUsers, projectedTags] = collectionsFromTables(compileTables([posts, users, tags]));

const user = (roles: string[], uid = "u-1"): { user: User } => ({
    user: { uid, displayName: null, email: null, photoURL: null, providerId: "test", isAnonymous: false, roles }
});
const anonymous: { user: User | null } = { user: null };
const OPS: SecurityOperation[] = ["select", "insert", "update", "delete"];
const allowed = (caller: { user: User | null }, values: Record<string, unknown> | null = null): SecurityOperation[] => {
    const entity: Entity | null = values ? { id: "1", path: "posts", values } : null;
    return OPS.filter(op => checkOperation(projectedPosts, caller, entity, op));
};

describe("posts, compiled and projected", () => {
    it("keeps the slug and every key", () => {
        expect(projectedPosts.slug).toBe("posts");
        const keys = Object.keys(projectedPosts.properties);
        for (const key of ["id", "title", "slug", "status", "heroImage", "embedding", "metadata", "publishDate", "orgId", "createdAt", "updatedAt", "deletedAt", "__order", "author", "tags"]) {
            expect(keys).toContain(key);
        }
        expect(keys.some(key => key === "authorId" || key === "author_id")).toBe(false);
    });

    it("labels the table and its columns", () => {
        expect(projectedPosts).toMatchObject({ name: "Posts", singularName: "Post" });
        expect(projectedPosts.properties.heroImage.name).toBe("Hero Image");
        expect(projectedPosts.properties.publishDate.name).toBe("Publish Date");
    });

    it("picks the widgets", () => {
        const widgetOf = (key: string) => getDefaultFieldId(projectedPosts.properties[key]);
        expect(widgetOf("title")).toBe("text_field");
        expect(widgetOf("status")).toBe("select");
        expect(widgetOf("heroImage")).toBe("file_upload");
        expect(widgetOf("embedding")).toBe("vector_input");
        expect(widgetOf("metadata")).toBe("key_value");
        expect(widgetOf("publishDate")).toBe("date_time");
        expect(widgetOf("author")).toBe("relation");
        expect(projectedPosts.properties.heroImage).toMatchObject({ storage: { storagePath: "posts/heroes/", acceptedFiles: ["image/*"], maxSize: 10 * 1024 * 1024 } });
        expect(projectedPosts.properties.status).toMatchObject({ defaultValue: "draft", validation: { required: true } });
        expect(projectedPosts.properties.title).toMatchObject({ validation: { required: true, min: 3, max: 200 } });
        expect(projectedPosts.properties.slug).toMatchObject({ validation: { required: true, unique: true, max: 160 } });
        expect(projectedPosts.properties.id).toMatchObject({ isId: "uuid" });
    });

    it("keeps the audit dates read-only and out of the table, the tenant filled by the server", () => {
        expect(projectedPosts.properties.createdAt).toMatchObject({ autoValue: "on_create", admin: { readOnly: true, hideFromCollection: true } });
        expect(projectedPosts.properties.updatedAt).toMatchObject({ autoValue: "on_update", admin: { readOnly: true, hideFromCollection: true } });
        expect(projectedPosts.properties.orgId.admin).toEqual({ filledByServer: true });
    });

    it("resolves the relations to the collections projected beside it", () => {
        const relations = resolveCollectionRelations(projectedPosts);
        expect(relations.author).toMatchObject({ kind: "belongsTo", localKey: "author_id" });
        expect(relations.author.target()).toBe(projectedUsers);
        expect(projectedPosts.properties.author).toMatchObject({ validation: { required: true } });
        expect(relations.tags).toMatchObject({ kind: "manyToMany", through: { table: "posts_tags" } });
        expect(relations.tags.target()).toBe(projectedTags);
        expect(getEntityChildViews(projectedPosts).map(view => view.key)).toEqual(["tags"]);
    });

    it("carries the table features, and leaves presentation to the panel", () => {
        expect(projectedPosts).toMatchObject({
            history: true,
            softDelete: { field: "deletedAt" },
            tenant: { field: "orgId", from: { claim: "org_id" } }
        });
        expect(projectedPosts).not.toHaveProperty("defaultViewMode");
        expect(projectedPosts).not.toHaveProperty("display");
    });

    it("reflects the permissions for anonymous, editor and admin", () => {
        expect(allowed(anonymous, { status: "published" })).toEqual(["select"]);
        expect(allowed(anonymous, { status: "draft" })).toEqual([]);
        expect(allowed(user(["editor"]))).toEqual(["select", "insert", "update"]);
        expect(allowed(user(["admin"]))).toEqual(["select", "insert", "update", "delete"]);
        expect(allowed(user([]), { status: "draft" })).toEqual([]);
    });
});

describe("users and tags, compiled and projected", () => {
    it("users is the auth collection, the admin's alone", () => {
        expect(projectedUsers.auth).toMatchObject({ enabled: true });
        const can = (roles: string[], op: SecurityOperation) => checkOperation(projectedUsers, user(roles, "other"), { id: "1", path: "users", values: { id: "1" } }, op);
        expect(OPS.every(op => can(["admin"], op))).toBe(true);
        expect(OPS.some(op => can(["editor"], op))).toBe(false);
        expect(projectedUsers.properties).not.toHaveProperty("passwordHash");
    });

    it("tags is public to read, written by editors and admins", () => {
        const can = (caller: { user: User | null }, op: SecurityOperation) => checkOperation(projectedTags, caller, null, op);
        expect(can(anonymous, "select")).toBe(true);
        expect(can(anonymous, "insert")).toBe(false);
        expect(can(user(["editor"]), "delete")).toBe(true);
        expect(can(user(["admin"]), "update")).toBe(true);
        expect(can(user([]), "update")).toBe(false);
    });
});
