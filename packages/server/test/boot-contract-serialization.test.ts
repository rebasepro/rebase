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
    };
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
                relation: {
                    kind: "belongsTo",
                    target: () => authors,
                    relationName: "author",
                    localKey: "author_id",
                }
            }
        }
    };
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
        // The link is nested under `relation` now; the serializer walks by key
        // so it rebuilds the thunk wherever it sits.
        const relation = (restoredPosts.properties as Record<string, {
            relation?: { target?: () => CollectionConfig | undefined };
        }>).author.relation!;

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
            relation?: { target?: () => CollectionConfig | undefined };
        }>).author.relation!;

        expect(typeof relation.target).toBe("function");
        expect(relation.target!()).toBeUndefined();
    });

    it("drops functions that are not relation targets", () => {
        const collection: CollectionConfig = {
            name: "Widgets",
            slug: "widgets",
            properties: { id: { name: "ID", type: "string", isId: "uuid" } },
            callbacks: { beforeSave: () => ({}) }
        };

        const [serialized] = serializeCollections([collection]) as Record<string, unknown>[];

        // Server-side behaviour is neither useful to a client nor safe to publish.
        expect(serialized.callbacks).toBeUndefined();
        expect(serialized.slug).toBe("widgets");
    });

    it("does not hang on a collection that references itself", () => {
        // A key the type does not declare: the walk serializes whatever a
        // collection object carries, which is where a cycle can hide.
        const self: CollectionConfig & { parent?: unknown } = { name: "Node", slug: "nodes", properties: {} };
        self.parent = self;

        const serialized = serializeCollections([self]);
        expect(serialized).toHaveLength(1);
        expect(JSON.stringify(serialized)).toContain("nodes");
    });

    it("does not let a cycle cut in one branch truncate a shared node in another", () => {
        // Memoizing the walk made it linear instead of exponential, but a result
        // produced where a cycle had to be cut is only valid at that position.
        // Serializing `first: b` visits `a` beneath `b`, cutting the edge back to
        // `b`; reusing that truncated `a` for `second` would silently drop `b`
        // from a branch where nothing needed cutting.
        const a: Record<string, unknown> = { name: "a" };
        const b: Record<string, unknown> = { name: "b",
            a };
        a.b = b;

        // `first` and `second` are keys no collection declares; the walk
        // carries them anyway, so they are where the shared node can sit.
        const things = {
            name: "Things",
            slug: "things",
            properties: {},
            first: b,
            second: a
        };
        // The contract is `unknown[]` by design (it is JSON for the wire); this
        // collection serializes to an object, which is what the reads below need.
        const [serialized] = serializeCollections([things]) as Record<string, unknown>[];

        const second = serialized.second as Record<string, unknown>;
        expect(second.name).toBe("a");
        expect(second.b).toBeDefined();
        expect((second.b as Record<string, unknown>).name).toBe("b");
    });

    it("serializes a widely shared subtree without exploding", () => {
        // A diamond graph is reachable by exponentially many paths. Before
        // memoization a 20-deep one took ~400ms and each further level doubled.
        let node: Record<string, unknown> = { leaf: true };
        for (let i = 0; i < 20; i++) {
            node = { left: node,
                right: node };
        }

        const started = Date.now();
        const deep = {
            name: "Deep",
            slug: "deep",
            properties: {},
            graph: node
        };
        const result = serializeCollections([deep]);

        expect(result).toHaveLength(1);
        expect(Date.now() - started).toBeLessThan(2000);
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
        const a: CollectionConfig = { name: "A", slug: "a", properties: { id: { name: "ID", type: "string" } } };
        const b: CollectionConfig = { slug: "b", properties: { id: { type: "string", name: "ID" } }, name: "B" };

        const first = computeSchemaVersion([a, b]);
        const second = computeSchemaVersion([b, a]);

        expect(first).toBe(second);
    });

    it("changes when a property changes", () => {
        const before: CollectionConfig[] = [{
            name: "A",
            slug: "a",
            properties: { id: { name: "ID", type: "string" } }
        }];

        const after: CollectionConfig[] = [{
            name: "A",
            slug: "a",
            properties: { id: { name: "ID", type: "string" }, title: { name: "Title", type: "string" } }
        }];

        expect(computeSchemaVersion(before)).not.toBe(computeSchemaVersion(after));
    });

    it("ignores callbacks, so editing a hook does not invalidate every client SDK", () => {
        const base: CollectionConfig = {
            name: "A",
            slug: "a",
            properties: { id: { name: "ID", type: "string" } }
        };

        const withHook = { ...base, callbacks: { beforeSave: () => ({}) } };

        expect(computeSchemaVersion([base]))
            .toBe(computeSchemaVersion([withHook]));
    });

    it("ignores security rules, which never appear in a generated client", () => {
        // These are also applied by the runtime at load time, so hashing them
        // made a build-time stamp that could never match the server serving it.
        const base: CollectionConfig = {
            name: "A",
            slug: "a",
            properties: { id: { name: "ID", type: "string" } }
        };
        const withRules: CollectionConfig = {
            ...base,
            securityRules: [{ name: "a_all", operation: "all", using: "true" }]
        };

        expect(computeSchemaVersion([base]))
            .toBe(computeSchemaVersion([withRules]));
    });

    it("ignores presentation-only settings", () => {
        const base: CollectionConfig = {
            name: "A",
            slug: "a",
            properties: { id: { name: "ID", type: "string" } }
        };

        // `admin` is declared by `@rebasepro/cms-types`, which the server does
        // not load; a collection file that does carries it, and it must not count.
        const presented = { ...base, admin: { icon: "Star", group: "Content" }, description: "hi" };

        expect(computeSchemaVersion([base]))
            .toBe(computeSchemaVersion([presented]));
    });

    it("still changes when a relation target changes", () => {
        const authors = authorsCollection();
        const others: CollectionConfig = { name: "Other", slug: "other", properties: {} };

        const toAuthors = computeSchemaVersion([postsCollection(authors)]);
        const toOther = computeSchemaVersion([postsCollection(others)]);

        expect(toAuthors).not.toBe(toOther);
    });

    it("is prefixed so the algorithm can change later without ambiguity", () => {
        const version = computeSchemaVersion([{
            name: "A",
            slug: "a",
            properties: {}
        }]);

        expect(version).toMatch(/^v1:[0-9a-f]{16}$/);
    });
});
