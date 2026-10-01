/**
 * The schema the typed-SDK probes are written against.
 *
 * `database.types.ts` beside this file is the codegen's output for exactly
 * these collections, checked in so this program can read it without running
 * anything. `packages/codegen/test/baas-typecheck-fixture.test.ts` regenerates
 * it and fails when the two differ, so the probes always describe what the
 * generator emits today rather than what it emitted when they were written.
 *
 * The shape is chosen for the seams the probes cross: a snake_case slug and a
 * kebab slug (accessor and wire name differ), every relation kind the SDK
 * writes, nullable columns, a date, a vector, enums, a never-writable field
 * and an API-hidden one.
 */
import { defineCollection } from "@rebasepro/common";
import type { AnyCollectionConfig } from "@rebasepro/types";

export const authors = defineCollection({
    name: "Authors",
    slug: "authors",
    table: "authors",
    properties: {
        id: { name: "Id", type: "number", isId: "increment" },
        name: { name: "Name", type: "string", validation: { required: true } },
        passwordHash: { name: "Hash", type: "string", excludeFromApi: true },
        salary: { name: "Salary", type: "number", access: { read: ["hr"], write: ["hr"] } },
        computed: { name: "Computed", type: "string", access: { write: [] } },
        createdAt: { name: "Created", type: "date", autoValue: "on_create" },
        posts: {
            name: "Posts",
            type: "relation",
            relation: { kind: "hasMany", target: (): AnyCollectionConfig => posts, foreignKeyOnTarget: "author_id" }
        }
    }
});

export const tags = defineCollection({
    name: "Tags",
    slug: "tags",
    table: "tags",
    properties: {
        id: { name: "Id", type: "string", isId: "uuid" },
        label: { name: "Label", type: "string", validation: { required: true } }
    }
});

export const posts = defineCollection({
    name: "Posts",
    slug: "posts",
    table: "posts",
    properties: {
        id: { name: "Id", type: "string", isId: "uuid" },
        title: { name: "Title", type: "string", validation: { required: true } },
        subtitle: { name: "Subtitle", type: "string" },
        status: { name: "Status", type: "string", enum: { draft: "Draft", published: "Published" } },
        views: { name: "Views", type: "number" },
        tagsList: { name: "Tag list", type: "array", of: { name: "Tag", type: "string" } },
        embedding: { name: "Embedding", type: "vector", dimensions: 3 },
        publishedAt: { name: "Published at", type: "date" },
        author: {
            name: "Author",
            type: "relation",
            relation: { kind: "belongsTo", target: (): AnyCollectionConfig => authors, localKey: "author_id" }
        },
        tags: { name: "Tags", type: "relation", relation: { kind: "manyToMany", target: () => tags } }
    }
});

export const orderItems = defineCollection({
    name: "Order items",
    slug: "order_items",
    table: "order_items",
    properties: {
        id: { name: "Id", type: "number", isId: "increment" },
        sku: { name: "SKU", type: "string", validation: { required: true } },
        quantity: { name: "Quantity", type: "number" }
    }
});

export const myNotes = defineCollection({
    name: "My notes",
    slug: "my-notes",
    table: "my_notes",
    properties: {
        id: { name: "Id", type: "string", isId: true },
        body: { name: "Body", type: "string" }
    }
});

export const collections = [authors, tags, posts, orderItems, myNotes];
