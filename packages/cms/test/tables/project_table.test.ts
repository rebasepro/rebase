import { describe, expect, it } from "@jest/globals";
import type { TableDescriptor } from "@rebasepro/types";
import { getPrimaryKeys } from "@rebasepro/cms-types";
import { collectionFromTable, collectionsFromTables, defaultDisplay } from "../../src/tables";
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

    it("is named from the table and opens as a table", () => {
        expect(collection).toMatchObject({ name: "Posts", singularName: "Post", defaultViewMode: "table" });
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

    it("hides the tenant column from the table and lets the server fill it on create", () => {
        expect(collection.properties.orgId.admin).toEqual({ filledByServer: true, hideFromCollection: true });
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

describe("default display slots", () => {
    it("fills the spec's posts slots", () => {
        expect(collectionFromTable(posts, { tables: all }).display).toEqual({
            title: "title",
            image: "heroImage",
            status: "status",
            date: "publishDate"
        });
    });

    it("leaves slots to the panel when no column says it belongs there", () => {
        const plain = table("events", { columns: [uuidId(), column("payload", { kind: "jsonb" }), column("kind", { kind: "text" })] });
        expect(collectionFromTable(plain, { tables: [] })).not.toHaveProperty("display");
    });

    it("falls back to the update stamp, then the create stamp, for the date", () => {
        const stamped = table("t", {
            columns: [
                uuidId(),
                column("createdAt", { kind: "timestamptz" }, { stamp: { on: "create", value: "now" } }),
                column("updatedAt", { kind: "timestamptz" }, { stamp: { on: "update", value: "now" } })
            ]
        });
        expect(defaultDisplay(stamped, new Set(["createdAt", "updatedAt"]))).toEqual({ date: "updatedAt" });
        expect(defaultDisplay(stamped, new Set(["createdAt"]))).toEqual({ date: "createdAt" });
    });

    it("takes a name column as the title, never an enum or a file", () => {
        const t = table("t", {
            columns: [
                uuidId(),
                column("label", { kind: "enum", values: ["a"] }),
                column("name", { kind: "text" }, { storage: { path: "x/" } }),
                column("displayName", { kind: "varchar", length: 80 }),
                column("title", { kind: "text" })
            ]
        });
        expect(defaultDisplay(t, new Set(t.columns.map(c => c.key)))?.title).toBe("displayName");
    });

    it("takes only an image file as the image", () => {
        const t = table("t", {
            columns: [
                uuidId(),
                column("attachment", { kind: "text" }, { storage: { path: "x/", accept: ["application/pdf"] } }),
                column("photo", { kind: "text" }, { storage: { path: "x/", accept: ["image/png"] } })
            ]
        });
        expect(defaultDisplay(t, new Set(t.columns.map(c => c.key)))).toEqual({ image: "photo" });
    });

    it("takes status only from a closed set", () => {
        const t = table("t", { columns: [uuidId(), column("status", { kind: "text" })] });
        expect(defaultDisplay(t, new Set(["id", "status"]))).toBeUndefined();
        const set = table("t", { columns: [uuidId(), column("status", { kind: "text" }, { oneOf: ["on", "off"] })] });
        expect(defaultDisplay(set, new Set(["id", "status"]))).toEqual({ status: "status" });
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
