import { CollectionConfig, RelationProperty, MapProperty } from "@rebasepro/types";
import { CollectionRegistry } from "../src/collections/CollectionRegistry";
import { resolveRelation } from "../src/util/resolve-relation";
import { resolveCollectionRelations } from "../src/util/relations";

/**
 * Replaces the suites that pinned `sanitizeRelation` and the property-hoisting
 * layers. Both are gone by design: the kind is declared, so nothing infers it,
 * and `resolveCollectionRelations` reads the two sources directly rather than
 * flattening one into the other.
 *
 * What is left to test is defaulting — deterministic, total, and the only thing
 * resolution still does.
 */

const tags: CollectionConfig = {
    slug: "tags", name: "Tags", table: "tags",
    properties: { id: { type: "string" } }
} as unknown as CollectionConfig;

const posts: CollectionConfig = {
    slug: "posts", name: "Posts", table: "posts",
    properties: { id: { type: "string" } }
} as unknown as CollectionConfig;

describe("resolveRelation — defaults", () => {

    it("derives a belongsTo column from the relation's name", () => {
        const r = resolveRelation({ kind: "belongsTo", relationName: "author", target: () => tags }, posts);
        expect(r).toMatchObject({
            kind: "belongsTo", cardinality: "one", writable: true, shared: false,
            localKey: "author_id", targetSlug: "tags"
        });
    });

    it("derives a hasMany column from the *source* collection's name", () => {
        // The column lives on the target and names this collection, which is the
        // opposite of belongsTo and the pair the old inference kept confusing.
        const r = resolveRelation({ kind: "hasMany", relationName: "comments", target: () => tags }, posts);
        expect(r).toMatchObject({ kind: "hasMany", cardinality: "many", foreignKeyOnTarget: "post_id" });
    });

    it("passes `sourceKey` through, and leaves it undefined when unset", () => {
        // The one field resolution does not default, because the default is the
        // source's primary key and that needs the driver's schema to resolve.
        const natural = resolveRelation(
            { kind: "hasMany", relationName: "apps", target: () => tags, sourceKey: "auth_user_id" }, posts);
        expect(natural).toMatchObject({ kind: "hasMany", sourceKey: "auth_user_id" });

        const byId = resolveRelation({ kind: "hasMany", relationName: "apps", target: () => tags }, posts);
        expect(byId.kind === "hasMany" && byId.sourceKey).toBeUndefined();
    });

    it("derives a junction table both sides agree on", () => {
        const fromPosts = resolveRelation({ kind: "manyToMany", relationName: "tags", target: () => tags }, posts);
        const fromTags = resolveRelation({ kind: "manyToMany", relationName: "posts", target: () => posts }, tags);

        // Sorted, so neither side has to know what the other chose.
        expect(fromPosts.kind === "manyToMany" && fromPosts.through.table).toBe("posts_tags");
        expect(fromTags.kind === "manyToMany" && fromTags.through.table).toBe("posts_tags");
        expect(fromPosts).toMatchObject({ cardinality: "many", shared: true });
    });

    it("keeps an authored junction exactly as written", () => {
        const r = resolveRelation({
            kind: "manyToMany", relationName: "tags", target: () => tags,
            through: { table: "j", sourceColumn: "p", targetColumn: "t" }
        }, posts);
        expect(r.kind === "manyToMany" && r.through).toEqual({ table: "j", sourceColumn: "p", targetColumn: "t" });
    });

    it("marks `via` unwritable and shared", () => {
        const r = resolveRelation({
            kind: "via", relationName: "x", target: () => tags, cardinality: "many",
            joinPath: [{ table: "tags", on: { from: "id", to: "post_id" } }]
        }, posts);
        expect(r).toMatchObject({ kind: "via", cardinality: "many", writable: false, shared: true });
    });

    it("names a relation by declaration, then property key, then target slug", () => {
        expect(resolveRelation({ kind: "hasMany", relationName: "named", target: () => tags }, posts).relationName).toBe("named");
        expect(resolveRelation({ kind: "hasMany", target: () => tags }, posts, "byKey").relationName).toBe("byKey");
        expect(resolveRelation({ kind: "hasMany", target: () => tags }, posts).relationName).toBe("tags");
    });

    it("reports an unresolvable target instead of dropping the relation", () => {
        // The old resolver wrapped every relation in a try/catch and silently
        // omitted whatever it could not work out.
        expect(() => resolveRelation({ kind: "hasMany", relationName: "x", target: (() => undefined) as never }, posts))
            .toThrow(/resolved to `undefined`/);
    });
});

/**
 * The thunk defers the reference, so a cycle that closes at import time is
 * fine. A cycle that leaves the binding permanently unusable is not, and both
 * of its shapes used to surface as something other than "import cycle".
 */
describe("resolveRelation — import cycles", () => {

    it("names the cycle when the thunk hits a dead binding", () => {
        // What a `const`/`class` in a not-yet-evaluated ES module does: the
        // thunk itself is fine, the binding it reads is in the TDZ.
        const target = (() => {
            throw new ReferenceError("jobsCollection is not defined");
        }) as never;

        expect(() => resolveRelation({ kind: "belongsTo", relationName: "promoted_job", target }, posts))
            .toThrow(/'promoted_job' on 'posts' targets a collection that is not initialized yet.*import cycle/s);
    });

    it("keeps the original ReferenceError as the cause", () => {
        const original = new ReferenceError("jobsCollection is not defined");
        const target = (() => { throw original; }) as never;

        try {
            resolveRelation({ kind: "belongsTo", relationName: "promoted_job", target }, posts);
            throw new Error("expected resolveRelation to throw");
        } catch (error) {
            expect((error as Error).cause).toBe(original);
        }
    });

    it("does not swallow errors that are not dead bindings", () => {
        const target = (() => { throw new TypeError("the thunk itself is broken"); }) as never;
        expect(() => resolveRelation({ kind: "belongsTo", target }, posts, "k"))
            .toThrow(/the thunk itself is broken/);
    });

    it("points at CJS interop when the thunk returns undefined", () => {
        // The other shape: the half-initialised module has no `default` yet, so
        // the thunk returns `undefined` rather than throwing.
        expect(() => resolveRelation({ kind: "belongsTo", target: (() => undefined) as never }, posts, "promoted_job"))
            .toThrow(/'promoted_job' on 'posts'.*resolved to `undefined`.*import cycle/s);
    });
});

describe("resolveCollectionRelations — the two sources", () => {

    const withBoth: CollectionConfig = {
        slug: "articles", name: "Articles", table: "articles",
        properties: {
            id: { type: "string" },
            tags: { type: "relation", relation: { kind: "manyToMany", target: () => tags } },
            meta: {
                type: "map",
                properties: {
                    nested: { type: "relation", relation: { kind: "hasMany", target: () => tags, foreignKeyOnTarget: "a_id" } }
                }
            }
        },
        relations: [{ kind: "hasMany", relationName: "declared", target: () => posts, foreignKeyOnTarget: "article_id" }]
    } as unknown as CollectionConfig;

    it("reads both the relations array and inline relation properties", () => {
        const resolved = resolveCollectionRelations(withBoth);
        expect(Object.keys(resolved).sort()).toEqual(["declared", "tags"]);
    });

    it("does not hoist a relation declared inside a map", () => {
        // The hoisting this replaces is what gave a map-nested relation a
        // top-level tab keyed by the inner property key.
        expect(resolveCollectionRelations(withBoth).nested).toBeUndefined();
    });
});

describe("normalization stamps the resolved relation", () => {

    it("stamps a top-level relation property without touching what was authored", () => {
        const registry = new CollectionRegistry([withStamp, tags]);
        const prop = registry.get("stamped")!.properties.tags as RelationProperty;

        expect(prop.resolvedRelation).toMatchObject({ kind: "manyToMany", targetSlug: "tags" });
        expect(prop.relation).toMatchObject({ kind: "manyToMany" });
        expect((prop.relation as { localKey?: string }).localKey).toBeUndefined();
    });

    it("stamps a relation nested inside a map", () => {
        const registry = new CollectionRegistry([withStamp, tags]);
        const map = registry.get("stamped")!.properties.meta as MapProperty;
        const nested = map.properties!.nested as RelationProperty;
        expect(nested.resolvedRelation).toMatchObject({ kind: "hasMany", foreignKeyOnTarget: "a_id" });
    });
});

const withStamp: CollectionConfig = {
    slug: "stamped", name: "Stamped", table: "stamped",
    properties: {
        id: { type: "string" },
        tags: { type: "relation", relation: { kind: "manyToMany", target: () => tags } },
        meta: {
            type: "map",
            properties: {
                nested: { type: "relation", relation: { kind: "hasMany", target: () => tags, foreignKeyOnTarget: "a_id" } }
            }
        }
    }
} as unknown as CollectionConfig;
