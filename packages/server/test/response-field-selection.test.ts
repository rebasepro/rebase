import { describe, expect, it } from "@jest/globals";
import type { CollectionConfig } from "@rebasepro/types";

import { projectResponseFields } from "../src/api/rest/write-validation";

/**
 * `?fields=id,title` is documented in the generated OpenAPI — "Comma-separated
 * list of fields to return (field selection)" — and it is the first parameter
 * shown on every endpoint in the API Explorer.
 *
 * It was parsed into `options.fields` and then read by nothing: no driver
 * referenced it, no response was shaped by it, and a caller asking for two
 * fields of a `posts` row still received its whole `content`. A documented
 * parameter that does nothing is worse than one that does not exist — the
 * reader believes they narrowed the response and cannot see that they did not.
 */

const posts = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        title: { name: "Title", type: "string" },
        content: { name: "Content", type: "string" },
        status: { name: "Status", type: "string" }
    }
} as unknown as CollectionConfig;

const row = () => ({ id: "p1", title: "Hello", content: "…long…", status: "published" });

describe("response field selection", () => {
    it("returns only the fields asked for", () => {
        const [projected] = projectResponseFields([row()], ["title"], posts);

        expect(Object.keys(projected).sort()).toEqual(["id", "title"]);
    });

    it("keeps the id even when it was not asked for", () => {
        // Rows are addressed by id everywhere above this layer — the admin
        // table, realtime reconciliation, the offline cache. A row without one
        // is not a smaller row, it is an unusable one.
        const [projected] = projectResponseFields([row()], ["title"], posts);

        expect(projected.id).toBe("p1");
    });

    it("changes nothing when no fields are given", () => {
        const original = row();

        expect(projectResponseFields([original], undefined, posts)[0]).toEqual(original);
        expect(projectResponseFields([original], [], posts)[0]).toEqual(original);
    });

    it("refuses a field the collection does not have, naming the ones it does", () => {
        expect(() => projectResponseFields([row()], ["titel"], posts))
            .toThrow(/'posts' has no field 'titel' to return\. Known fields: /);
    });

    it("carries a machine-readable code", () => {
        try {
            projectResponseFields([row()], ["titel"], posts);
            throw new Error("expected projectResponseFields to throw");
        } catch (err) {
            expect((err as { code?: string }).code).toBe("UNKNOWN_RESPONSE_FIELD");
            expect((err as { statusCode?: number }).statusCode).toBe(400);
        }
    });

    it("accepts a relation reached through `include`", () => {
        // `include` decides what is loaded, `fields` what is returned — so a
        // relation that is not a declared property must still be nameable.
        const withAuthor = { ...row(), author: { id: "a1", name: "Ada" } };

        const [projected] = projectResponseFields(
            [withAuthor], ["title", "author"], posts, { include: ["author"] }
        );

        expect(Object.keys(projected).sort()).toEqual(["author", "id", "title"]);
    });

    it("drops a loaded relation the caller did not ask to be returned", () => {
        const withAuthor = { ...row(), author: { id: "a1", name: "Ada" } };

        const [projected] = projectResponseFields(
            [withAuthor], ["title"], posts, { include: ["author"] }
        );

        expect(projected).not.toHaveProperty("author");
    });

    it("checks nothing against a collection that declares no properties", () => {
        // Same reasoning `assertKnownWriteFields` applies: "no declared fields"
        // is not the claim "no fields are allowed".
        const bare = { slug: "raw", name: "Raw", table: "raw" } as unknown as CollectionConfig;

        const [projected] = projectResponseFields([row()], ["title"], bare);

        expect(Object.keys(projected).sort()).toEqual(["id", "title"]);
    });

    it("projects every row, not just the first", () => {
        const rows = [row(), { ...row(), id: "p2", title: "Second" }];

        const projected = projectResponseFields(rows, ["title"], posts);

        expect(projected.map(r => Object.keys(r).sort())).toEqual([["id", "title"], ["id", "title"]]);
    });
});

/**
 * Every fixture above is keyed on a column literally named `id`. The reason
 * this function keeps the key — "a row that arrives without one is unusable" —
 * is not a statement about the name `id`, it is a statement about the key, and
 * the layer right beside this one already knows collections that have no `id`
 * column at all: `assertKnownWriteFields` has a dedicated error for them.
 */
const memberships = {
    slug: "memberships",
    name: "Memberships",
    table: "memberships",
    properties: {
        user_id: { name: "User", type: "string", isId: "uuid" },
        role_id: { name: "Role", type: "string", isId: "uuid" },
        granted_at: { name: "Granted", type: "date" },
        note: { name: "Note", type: "string" }
    }
} as unknown as CollectionConfig;

const articles = {
    slug: "articles",
    name: "Articles",
    table: "articles",
    properties: {
        slug: { name: "Slug", type: "string", isId: "string" },
        title: { name: "Title", type: "string" },
        body: { name: "Body", type: "string" }
    }
} as unknown as CollectionConfig;

describe("field selection on a collection not keyed on `id`", () => {
    it("keeps a single primary key that is not called id", () => {
        const [projected] = projectResponseFields(
            [{ slug: "hello-world", title: "Hello", body: "…" }],
            ["title"],
            articles
        );

        // Without its key this row cannot be opened, cached or reconciled —
        // the same reason the `id` case keeps one.
        expect(projected.slug).toBe("hello-world");
        expect(Object.keys(projected).sort()).toEqual(["slug", "title"]);
    });

    it("keeps every column of a composite key", () => {
        const [projected] = projectResponseFields(
            [{ user_id: "u1", role_id: "r1", granted_at: "2026-01-01", note: "n" }],
            ["note"],
            memberships
        );

        expect(projected.user_id).toBe("u1");
        expect(projected.role_id).toBe("r1");
    });

    it("does not invent an `id` key on a row that has none", () => {
        const [projected] = projectResponseFields(
            [{ slug: "hello-world", title: "Hello", body: "…" }],
            ["title"],
            articles
        );

        expect("id" in projected).toBe(false);
    });
});
