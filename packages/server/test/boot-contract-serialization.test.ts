import type { CollectionConfig, TableHooks } from "@rebasepro/types";
import {
    col,
    computeSchemaVersion,
    defineTable,
    deserializeCollections,
    rel,
    serializeCollections
} from "@rebasepro/types";
import { compileTables } from "@rebasepro/common";

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

describe("schema version — computed from the compiled tables", () => {
    const authors = defineTable("authors", {
        columns: { id: col.integer().primaryKey().identity(), name: col.text() },
        rls: "admin-only"
    });
    const others = defineTable("others", {
        columns: { id: col.uuid().primaryKey().defaultRandom() },
        rls: "admin-only"
    });
    const posts = (target: typeof authors | typeof others, hooks?: TableHooks) => defineTable("posts", {
        columns: { id: col.uuid().primaryKey().defaultRandom(), title: col.text() },
        relations: { author: rel.belongsTo(() => target) },
        rls: "admin-only",
        ...(hooks ? { hooks } : {})
    });
    const version = (...defs: Parameters<typeof compileTables>[0]) => computeSchemaVersion(compileTables(defs));

    it("does not move when only a hook's code changes — hooks are presence flags", () => {
        const one = version(authors, posts(authors, { beforeSave: ({ values }) => values }));
        const two = version(authors, posts(authors, { beforeSave: ({ values }) => ({ ...values, title: "x" }) }));
        expect(one).toBe(two);
    });

    it("moves when a hook is added", () => {
        expect(version(authors, posts(authors, { afterRead: ({ values }) => values })))
            .not.toBe(version(authors, posts(authors)));
    });

    it("still changes when a relation target changes", () => {
        expect(version(authors, others, posts(authors))).not.toBe(version(authors, others, posts(others)));
    });

    it("is prefixed v2, so a stamp from the collection model can never match", () => {
        expect(version(authors)).toMatch(/^v2:[0-9a-f]{16}$/);
    });
});
