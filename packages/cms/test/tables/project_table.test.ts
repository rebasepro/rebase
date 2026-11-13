import { describe, expect, it } from "@jest/globals";
import type { TableDescriptor } from "@rebasepro/types";
import { getPrimaryKeys } from "@rebasepro/cms-types";
import { collectionFromTable, collectionsFromTables } from "../../src/tables";
import { column, posts, table, tags, users, uuidId } from "./fixtures";

const all = [posts, users, tags];

describe("identity", () => {
    it("keeps the slug and every column key and relation name exactly", () => {
        const renamed: TableDescriptor = { ...posts, name: "blog_posts", slug: "articles", table: "blog_posts", schema: "content" };
        const collection = collectionFromTable(renamed, { tables: [renamed, users, tags] });
        expect(collection.slug).toBe("articles");
        expect(collection.table).toBe("blog_posts");
        expect(collection.schema).toBe("content");
        expect(Object.keys(collection.properties)).toEqual([
            "id", "title", "slug", "status", "heroImage", "embedding", "metadata", "publishDate",
            "orgId", "createdAt", "updatedAt", "deletedAt", "__order", "author", "tags"
        ]);
    });

    it("keeps the primary key the panel addresses rows by", () => {
        expect(getPrimaryKeys(collectionFromTable(posts, { tables: all }))).toEqual(["id"]);
        const composite = table("post_tags", {
            primaryKey: ["postId", "tagId"],
            columns: [column("postId", { kind: "uuid" }, { nullable: false }), column("tagId", { kind: "uuid" }, { nullable: false })]
        });
        expect(getPrimaryKeys(collectionFromTable(composite, { tables: [composite] }))).toEqual(["postId", "tagId"]);
    });

    it("drops a private column that slipped through", () => {
        const leaky = { ...users, columns: [...users.columns, column("passwordHash", { kind: "text" }, { private: true })] };
        expect(collectionFromTable(leaky, { tables: [leaky] }).properties).not.toHaveProperty("passwordHash");
    });
});

describe("the collection", () => {
    const collection = collectionFromTable(posts, { tables: all });

    it("is named from the table and leaves the view mode and open mode to the panel", () => {
        expect(collection).toMatchObject({ name: "Posts", singularName: "Post" });
        // An authored collection that said nothing opened as the list, a record
        // in the side panel: a projected table must open the same way.
        expect(collection).not.toHaveProperty("defaultViewMode");
        expect(collection).not.toHaveProperty("openEntityMode");
        expect(collectionFromTable(table("order_items", { columns: [uuidId()] }), { tables: [] }))
            .toMatchObject({ name: "Order Items", singularName: "Order Item" });
    });

    it("carries the table-level features", () => {
        expect(collection).toMatchObject({
            history: true,
            softDelete: { field: "deletedAt" },
            search: { fields: ["title"], language: "english" },
            tenant: { field: "orgId", from: { claim: "org_id" } }
        });
    });

    it("lets the server fill the tenant column on create, and keeps it among the columns", () => {
        expect(collection.properties.orgId.admin).toEqual({ filledByServer: true });
    });

    it("shows createdAt/updatedAt read-only and out of the default columns", () => {
        for (const key of ["createdAt", "updatedAt"]) {
            expect(collection.properties[key].admin).toEqual({ readOnly: true, hideFromCollection: true });
        }
    });

    it("carries the description, database and opaque metadata", () => {
        const described = collectionFromTable({ ...tags, description: "Topic labels", database: "analytics", metadata: { owner: "content" } }, { tables: [] });
        expect(described).toMatchObject({ description: "Topic labels", dataSource: "analytics", metadata: { owner: "content" } });
        expect(collectionFromTable(tags, { tables: [] })).not.toHaveProperty("description");
    });

    it("leaves the icon to the panel's name heuristic", () => {
        expect(collection).not.toHaveProperty("icon");
    });

    it("keeps strictWrites: false", () => {
        expect(collectionFromTable({ ...tags, strictWrites: false }, { tables: [] }).strictWrites).toBe(false);
    });
});

describe("the auth table", () => {
    const collection = collectionFromTable(users, { tables: all });

    it("is an auth collection, which is what the reset-password action keys on", () => {
        expect(collection.auth).toEqual({
            enabled: true,
            roles: { admin: { name: "Admin", scopes: [] }, editor: { name: "Editor", scopes: [] } }
        });
    });

    it("offers the declared roles in its roles column", () => {
        expect(collection.properties.roles).toMatchObject({
            type: "array",
            of: { type: "string", enum: [{ id: "admin", label: "Admin" }, { id: "editor", label: "Editor" }] }
        });
    });

    it("validates its email column as an e-mail", () => {
        expect(collection.properties.email).toMatchObject({ email: true, validation: { required: true, unique: true } });
    });
});

describe("display slots", () => {
    it("are left to the panel's own derivation, as for an authored collection that names none", () => {
        // A declared slot skips the panel's per-record ranking and draws the
        // record header; neither happened for a collection that said nothing.
        expect(collectionFromTable(posts, { tables: all })).not.toHaveProperty("display");
        const plain = table("events", { columns: [uuidId(), column("payload", { kind: "jsonb" }), column("kind", { kind: "text" })] });
        expect(collectionFromTable(plain, { tables: [] })).not.toHaveProperty("display");
    });
});

describe("collectionsFromTables", () => {
    it("projects every table in the order served", () => {
        expect(collectionsFromTables(all).map(c => c.slug)).toEqual(["posts", "users", "tags"]);
    });

    it("is deterministic", () => {
        expect(JSON.stringify(collectionsFromTables(all))).toBe(JSON.stringify(collectionsFromTables(all)));
    });
});
