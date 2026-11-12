/**
 * Hand-written `TableDescriptor`s, shaped as `GET /api/schema/tables` serves
 * them. Plain objects on purpose: the projector is tested against the wire
 * contract, not against whatever the compiler happens to emit today.
 */
import type { ColumnDescriptor, ColumnType, RlsDescriptor, TableDescriptor, User } from "@rebasepro/types";
import { toSnakeCase } from "@rebasepro/utils";

/** A column: `key`, its type, and any other facts. The SQL name is the snake-cased key. */
export function column(key: string, type: ColumnType, facts: Partial<ColumnDescriptor> = {}): ColumnDescriptor {
    return { key, column: toSnakeCase(key), type, nullable: true, ...facts };
}

/** A table with sensible defaults; `rls` is admin-only unless given. */
export function table(name: string, facts: Partial<TableDescriptor> & Pick<TableDescriptor, "columns">): TableDescriptor {
    return {
        name,
        slug: name,
        table: name,
        schema: "public",
        kind: "table",
        primaryKey: ["id"],
        relations: [],
        rls: { posture: "admin-only", rules: [], defaultPolicies: true },
        ...facts
    };
}

/** A uuid primary key with `gen_random_uuid()`. */
export const uuidId = (): ColumnDescriptor =>
    column("id", { kind: "uuid" }, { nullable: false, primaryKey: true, default: { kind: "random-uuid" } });

export const rules = (r: RlsDescriptor["rules"], defaultPolicies = true): RlsDescriptor =>
    ({ posture: "rules", rules: r, defaultPolicies });

/** The callers the permission tests ask about. */
export const anonymous: { user: User | null } = { user: null };
export const signedIn = (roles: string[], uid = "u-1"): { user: User } => ({
    user: { uid, displayName: null, email: null, photoURL: null, providerId: "test", isAnonymous: false, roles }
});

// ── The spec's §4.1 example, as the server would describe it ──────────────────

export const users = table("users", {
    columns: [
        uuidId(),
        column("email", { kind: "text" }, { nullable: false, unique: true, validate: { email: true } }),
        column("displayName", { kind: "text" }),
        column("roles", { kind: "array", of: { kind: "text" } }),
        column("createdAt", { kind: "timestamptz" }, { stamp: { on: "create", value: "now" } })
    ],
    auth: { roles: { admin: { name: "Admin", scopes: [] }, editor: { name: "Editor", scopes: [] } } },
    rls: { posture: "admin-only", rules: [], defaultPolicies: true }
});

export const tags = table("tags", {
    columns: [
        uuidId(),
        column("name", { kind: "text" }, { nullable: false })
    ],
    rls: rules([{ operation: "select", access: "public" }, { operations: ["insert", "update", "delete"], roles: ["editor"] }])
});

export const posts = table("posts", {
    columns: [
        uuidId(),
        column("title", { kind: "text" }, { nullable: false, validate: { min: 3, max: 200 } }),
        column("slug", { kind: "varchar", length: 160 }, { nullable: false, unique: true }),
        column("status", { kind: "enum", values: ["draft", "needs_review", "published", "archived"] }, {
            nullable: false,
            default: { kind: "literal", value: "draft" }
        }),
        column("heroImage", { kind: "text" }, { storage: { path: "posts/heroes/", accept: ["image/*"], maxBytes: 10 * 1024 * 1024 } }),
        column("embedding", { kind: "vector", dimensions: 1536 }, { vectorIndex: { method: "hnsw", metric: "cosine" } }),
        column("metadata", { kind: "jsonb" }),
        column("publishDate", { kind: "timestamptz" }),
        column("orgId", { kind: "uuid" }, { nullable: false }),
        column("createdAt", { kind: "timestamptz" }, { nullable: false, stamp: { on: "create", value: "now" } }),
        column("updatedAt", { kind: "timestamptz" }, { nullable: false, stamp: { on: "update", value: "now" } }),
        column("deletedAt", { kind: "timestamptz" }),
        column("__order", { kind: "text" }),
        column("authorId", { kind: "uuid" }, { column: "author_id", nullable: false, foreignKeyOf: "author" })
    ],
    relations: [
        {
            kind: "belongsTo", name: "author", target: "users", cardinality: "one",
            localKey: "author_id", localField: "authorId", onDelete: "restrict", index: true, constraint: true
        },
        {
            kind: "manyToMany", name: "tags", target: "tags", cardinality: "many",
            through: {
                table: "posts_tags",
                sourceKey: "post_id",
                targetKey: "tag_id",
                pivot: [
                    column("addedBy", { kind: "uuid" }),
                    column("sortOrder", { kind: "integer" }, { default: { kind: "literal", value: 0 } })
                ]
            }
        }
    ],
    rls: rules([
        { operation: "select", access: "public", condition: { kind: "compare", op: "eq", left: { kind: "field", name: "status" }, right: { kind: "literal", value: "published" } } },
        { operations: ["select", "insert", "update"], roles: ["editor"] },
        { operation: "delete", roles: ["admin"] }
    ]),
    tenant: { field: "orgId", from: { claim: "org_id" } },
    softDelete: { field: "deletedAt" },
    history: true,
    search: { fields: ["title"], language: "english" }
});
