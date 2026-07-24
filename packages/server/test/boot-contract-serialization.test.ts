import type { CollectionConfig } from "@rebasepro/types";
import {
    computeSchemaVersion,
    deserializeCollections,
    serializeCollections
} from "@rebasepro/types";

/**
 * Serializing collections for the contract endpoint.
 *
 * The thing worth guarding here is that a relation survives the round trip. A
 * relation points at its target with a *function*, and the SDK generator calls
 * that function to decide whether a foreign key is a string or a number. Drop it
 * and generation still "succeeds" — it just emits the wrong type, which is far
 * worse than an error.
 */

function authorsCollection(): CollectionConfig {
    return {
        name: "Authors",
        slug: "authors",
        properties: {
            id: { name: "ID", type: "number", isId: true },
            name: { name: "Name", type: "string" }
        }
    } as unknown as CollectionConfig;
}

function postsCollection(authors: CollectionConfig): CollectionConfig {
    return {
        name: "Posts",
        slug: "posts",
        properties: {
            id: { name: "ID", type: "string", isId: "uuid" },
            title: { name: "Title", type: "string" },
            author: {
                name: "Author",
                type: "relation",
                relationName: "author",
                cardinality: "one",
                direction: "owning",
                localKey: "author_id",
                target: () => authors
            }
        }
    } as unknown as CollectionConfig;
}

describe("collection contract serialization", () => {
    it("survives JSON and rebuilds relation targets", () => {
        const authors = authorsCollection();
        const posts = postsCollection(authors);

        // The real transport is JSON, so round-trip through it rather than
        // trusting the in-memory object.
        const wire = JSON.parse(JSON.stringify(serializeCollections([posts, authors])));
        const restored = deserializeCollections(wire);

        const restoredPosts = restored.find(c => c.slug === "posts")!;
        const relation = (restoredPosts.properties as Record<string, {
            target?: () => CollectionConfig | undefined;
        }>).author;

        expect(typeof relation.target).toBe("function");
        expect(relation.target!()?.slug).toBe("authors");
    });

    it("resolves a target that is missing from the payload to undefined, not a throw", () => {
        const authors = authorsCollection();
        const posts = postsCollection(authors);

        // Only the posts collection is served — the generator must degrade, not die.
        const wire = JSON.parse(JSON.stringify(serializeCollections([posts])));
        const restored = deserializeCollections(wire);

        const relation = (restored[0].properties as Record<string, {
            target?: () => CollectionConfig | undefined;
        }>).author;

        expect(typeof relation.target).toBe("function");
        expect(relation.target!()).toBeUndefined();
    });

    it("drops functions that are not relation targets", () => {
        const collection = {
            name: "Widgets",
            slug: "widgets",
            properties: { id: { name: "ID", type: "string", isId: "uuid" } },
            callbacks: { beforeSave: () => ({}) }
        } as unknown as CollectionConfig;

        const [serialized] = serializeCollections([collection]) as Record<string, unknown>[];

        // Server-side behaviour is neither useful to a client nor safe to publish.
        expect(serialized.callbacks).toBeUndefined();
        expect(serialized.slug).toBe("widgets");
    });

    it("does not hang on a collection that references itself", () => {
        const self: Record<string, unknown> = { name: "Node", slug: "nodes", properties: {} };
        self.parent = self;

        const serialized = serializeCollections([self as unknown as CollectionConfig]);
        expect(serialized).toHaveLength(1);
        expect(JSON.stringify(serialized)).toContain("nodes");
    });

    it("sorts by slug so the payload does not depend on input order", () => {
        const authors = authorsCollection();
        const posts = postsCollection(authors);

        const one = serializeCollections([posts, authors]) as { slug: string }[];
        const two = serializeCollections([authors, posts]) as { slug: string }[];

        expect(one.map(c => c.slug)).toEqual(["authors", "posts"]);
        expect(two.map(c => c.slug)).toEqual(["authors", "posts"]);
    });
});

describe("schema version", () => {
    it("is stable across input ordering and object key ordering", () => {
        const a = { name: "A", slug: "a", properties: { id: { name: "ID", type: "string" } } };
        const b = { slug: "b", properties: { id: { type: "string", name: "ID" } }, name: "B" };

        const first = computeSchemaVersion([a, b] as unknown as CollectionConfig[]);
        const second = computeSchemaVersion([b, a] as unknown as CollectionConfig[]);

        expect(first).toBe(second);
    });

    it("changes when a property changes", () => {
        const before = [{
            name: "A",
            slug: "a",
            properties: { id: { name: "ID", type: "string" } }
        }] as unknown as CollectionConfig[];

        const after = [{
            name: "A",
            slug: "a",
            properties: { id: { name: "ID", type: "string" }, title: { name: "Title", type: "string" } }
        }] as unknown as CollectionConfig[];

        expect(computeSchemaVersion(before)).not.toBe(computeSchemaVersion(after));
    });

    it("ignores callbacks, so editing a hook does not invalidate every client SDK", () => {
        const base = {
            name: "A",
            slug: "a",
            properties: { id: { name: "ID", type: "string" } }
        };

        const withHook = { ...base, callbacks: { beforeSave: () => ({}) } };

        expect(computeSchemaVersion([base] as unknown as CollectionConfig[]))
            .toBe(computeSchemaVersion([withHook] as unknown as CollectionConfig[]));
    });

    it("ignores security rules, which never appear in a generated client", () => {
        // These are also applied by the runtime at load time, so hashing them
        // made a build-time stamp that could never match the server serving it.
        const base = {
            name: "A",
            slug: "a",
            properties: { id: { name: "ID", type: "string" } }
        };
        const withRules = {
            ...base,
            securityRules: [{ name: "a_all", operation: "all", using: "true" }]
        };

        expect(computeSchemaVersion([base] as unknown as CollectionConfig[]))
            .toBe(computeSchemaVersion([withRules] as unknown as CollectionConfig[]));
    });

    it("ignores presentation-only settings", () => {
        const base = {
            name: "A",
            slug: "a",
            properties: { id: { name: "ID", type: "string" } }
        };

        expect(computeSchemaVersion([base] as unknown as CollectionConfig[]))
            .toBe(computeSchemaVersion([
                { ...base, icon: "Star", group: "Content", description: "hi" }
            ] as unknown as CollectionConfig[]));
    });

    it("still changes when a relation target changes", () => {
        const authors = authorsCollection();
        const others = { name: "Other", slug: "other", properties: {} } as unknown as CollectionConfig;

        const toAuthors = computeSchemaVersion([postsCollection(authors)]);
        const toOther = computeSchemaVersion([postsCollection(others)]);

        expect(toAuthors).not.toBe(toOther);
    });

    it("is prefixed so the algorithm can change later without ambiguity", () => {
        const version = computeSchemaVersion([{
            name: "A",
            slug: "a",
            properties: {}
        }] as unknown as CollectionConfig[]);

        expect(version).toMatch(/^v1:[0-9a-f]{16}$/);
    });
});
