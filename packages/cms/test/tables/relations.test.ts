/**
 * Relations project to the relation properties the panel already reads:
 * `resolveCollectionRelations` resolves them, a to-one is a picker in the form,
 * a to-many is a tab (`getEntityChildViews`) with the picker beside it hidden.
 */
import { describe, expect, it } from "@jest/globals";
import type { RelationDescriptor, TableDescriptor } from "@rebasepro/types";
import {
    getChildViewRelationPropertyKeys,
    getEntityChildViews,
    resolveCollectionRelations
} from "@rebasepro/common";
import { getDefaultFieldId } from "../../src/components/field_ids";
import { collectionFromTable, collectionsFromTables } from "../../src/tables";
import { column, posts, table, tags, users, uuidId } from "./fixtures";

const comments = table("comments", {
    columns: [
        uuidId(),
        column("body", { kind: "text" }),
        column("postId", { kind: "uuid" }, { column: "post_id", nullable: false, foreignKeyOf: "post", description: "The post" })
    ],
    relations: [{
        kind: "belongsTo", name: "post", target: "posts", cardinality: "one",
        localKey: "post_id", localField: "postId", onDelete: "cascade", index: true, constraint: true
    }]
});

const profiles = table("profiles", {
    columns: [uuidId(), column("userId", { kind: "uuid" }, { column: "user_id", foreignKeyOf: "user" })],
    relations: [{
        kind: "belongsTo", name: "user", target: "users", cardinality: "one",
        localKey: "user_id", localField: "userId", index: true, constraint: true
    }]
});

const withMany = (relations: RelationDescriptor[]): TableDescriptor => ({ ...posts, relations: [...posts.relations, ...relations] });

const all = [posts, users, tags, comments, profiles];

describe("belongsTo", () => {
    const collection = collectionFromTable(posts, { tables: all });

    it("is a relation picker under the relation's name, in the foreign key's place", () => {
        const author = collection.properties.author;
        expect(author).toMatchObject({
            type: "relation",
            name: "Author",
            validation: { required: true },
            relation: { kind: "belongsTo", relationName: "author", localKey: "author_id", onDelete: "restrict", index: true }
        });
        expect(getDefaultFieldId(author)).toBe("relation");
        const keys = Object.keys(collection.properties);
        expect(keys).not.toContain("authorId");
        expect(keys.indexOf("author")).toBe(keys.indexOf("__order") + 1);
    });

    it("resolves through the panel's own resolver to the target collection", () => {
        const resolved = resolveCollectionRelations(collection);
        expect(resolved.author).toMatchObject({ kind: "belongsTo", targetSlug: "users", localKey: "author_id", cardinality: "one" });
        expect(resolved.author.target().slug).toBe("users");
    });

    it("carries the foreign key's description, access and read-only state", () => {
        const c = collectionFromTable({
            ...comments,
            columns: comments.columns.map(col => col.key === "postId" ? { ...col, access: { write: ["admin"] }, readOnly: true as const } : col)
        }, { tables: all });
        expect(c.properties.post).toMatchObject({ description: "The post", access: { write: ["admin"] }, admin: { readOnly: true } });
        expect(c.properties.post.validation).toBeUndefined();
    });

    it("a nullable foreign key is an optional picker", () => {
        expect(collectionFromTable(profiles, { tables: all }).properties.user.validation).toBeUndefined();
    });

    it("degrades to a plain key field when the target was not served", () => {
        const c = collectionFromTable(posts, { tables: [posts, tags] });
        expect(c.properties).not.toHaveProperty("author");
        expect(c.properties.authorId).toMatchObject({ type: "string", columnType: "uuid", columnName: "author_id", validation: { required: true } });
        expect(() => resolveCollectionRelations(c)).not.toThrow();
    });

    it("is left out when its foreign key did not arrive", () => {
        const c = collectionFromTable({ ...comments, columns: comments.columns.filter(col => col.key !== "postId") }, { tables: all });
        expect(c.properties).not.toHaveProperty("post");
    });

    it("keeps a foreign key that is part of the primary key as the id field", () => {
        const memberships = table("memberships", {
            primaryKey: ["userId"],
            columns: [column("userId", { kind: "uuid" }, { column: "user_id", nullable: false, foreignKeyOf: "user" })],
            relations: [{ kind: "belongsTo", name: "user", target: "users", cardinality: "one", localKey: "user_id", localField: "userId", index: true, constraint: true }]
        });
        const c = collectionFromTable(memberships, { tables: [memberships, users] });
        expect(c.properties.userId).toMatchObject({ isId: "manual" });
        expect(c.properties.user).toMatchObject({ type: "relation" });
    });
});

describe("to-many relations", () => {
    it("manyToMany is a tab, its picker hidden, with the junction spelled out and its pivot columns", () => {
        const collection = collectionFromTable(posts, { tables: all });
        expect(collection.properties.tags).toMatchObject({
            type: "relation",
            name: "Tags",
            relation: {
                kind: "manyToMany",
                through: {
                    table: "posts_tags",
                    sourceColumn: "post_id",
                    targetColumn: "tag_id",
                    properties: {
                        addedBy: { type: "string", columnType: "uuid", columnName: "added_by" },
                        sortOrder: { type: "number", defaultValue: 0, columnName: "sort_order" }
                    }
                }
            }
        });
        const views = getEntityChildViews(collection);
        expect(views.map(v => [v.key, v.source])).toEqual([
            ["tags", { kind: "relation", relationKey: "tags", mode: "linked", targetSlug: "tags" }]
        ]);
        expect(getChildViewRelationPropertyKeys(collection)).toEqual(new Set(["tags"]));
    });

    it("hasMany is an owned tab with its foreign key and order", () => {
        const collection = collectionFromTable(withMany([{
            kind: "hasMany", name: "comments", target: "comments", cardinality: "many", foreignKey: "post_id",
            orderBy: [["createdAt", "desc"]]
        }]), { tables: all });
        expect(collection.properties.comments).toMatchObject({
            type: "relation",
            relation: { kind: "hasMany", relationName: "comments", foreignKeyOnTarget: "post_id" }
        });
        const tab = getEntityChildViews(collection).find(v => v.key === "comments");
        expect(tab?.source).toEqual({ kind: "relation", relationKey: "comments", mode: "owned", targetSlug: "comments" });
    });

    it("hasOne is a to-one relation keyed by the target's foreign key, with its natural key", () => {
        const c = collectionFromTable(table("users", {
            columns: users.columns,
            relations: [{ kind: "hasOne", name: "profile", target: "profiles", cardinality: "one", foreignKey: "user_id", sourceKey: "id" }]
        }), { tables: all });
        expect(c.properties.profile).toMatchObject({ relation: { kind: "hasOne", foreignKeyOnTarget: "user_id", sourceKey: "id" } });
        expect(resolveCollectionRelations(c).profile.cardinality).toBe("one");
        expect(getEntityChildViews(c)).toEqual([]);
    });

    it("via keeps its steps and cardinality, and is read-only when not writable", () => {
        const c = collectionFromTable(withMany([{
            kind: "via", name: "commenters", target: "users", cardinality: "many", writable: false,
            steps: [
                { table: "comments", on: { from: "posts.id", to: "comments.post_id" } },
                { table: "users", on: { from: "comments.author_id", to: "users.id" } }
            ]
        }]), { tables: all });
        expect(c.properties.commenters).toMatchObject({
            admin: { readOnly: true },
            relation: { kind: "via", cardinality: "many", joinPath: [{ table: "comments" }, { table: "users" }] }
        });
        // The panel's resolver derives `writable` from the steps on its own; the
        // server's answer reaches the form as the read-only flag.
        expect(resolveCollectionRelations(c).commenters).toMatchObject({ kind: "via", targetSlug: "users" });
    });

    it("a to-many relation to a table that was not served is left out", () => {
        const c = collectionFromTable(withMany([{
            kind: "hasMany", name: "comments", target: "comments", cardinality: "many", foreignKey: "post_id"
        }]), { tables: [posts, users] });
        expect(c.properties).not.toHaveProperty("comments");
        expect(c.properties).not.toHaveProperty("tags");
        expect(getEntityChildViews(c)).toEqual([]);
    });
});

describe("targets", () => {
    it("are the collections listed beside them when projected together", () => {
        const [projectedPosts, projectedUsers] = collectionsFromTables([posts, users, tags]);
        const author = resolveCollectionRelations(projectedPosts).author;
        expect(author.target()).toBe(projectedUsers);
    });

    it("resolve a self-reference without recursing", () => {
        const categories = table("categories", {
            columns: [uuidId(), column("parentId", { kind: "uuid" }, { column: "parent_id", foreignKeyOf: "parent" })],
            relations: [{ kind: "belongsTo", name: "parent", target: "categories", cardinality: "one", localKey: "parent_id", localField: "parentId", index: true, constraint: true }]
        });
        const c = collectionFromTable(categories, { tables: [] });
        expect(resolveCollectionRelations(c).parent.target()).toBe(c);
    });
});
