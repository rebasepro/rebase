import { CollectionRegistry } from "../src/collections/CollectionRegistry";
import { getEntityChildViews, getSubcollections } from "../src/util";
import type { CollectionConfig } from "@rebasepro/types";

/**
 * A child view is keyed by the **relation key**, and both path resolvers agree
 * on it.
 *
 * They used not to. `CollectionRegistry.normalizeCollection` stamped each
 * relation-derived child with the *target collection's* slug and cached it onto
 * `childCollections`, which shadowed the correct derivation. So
 * `resolvePathToCollections` (matching a segment against a child slug) and
 * `getCollectionByPath` (matching it against a relation key) each accepted the
 * path the other rejected, and the admin built the frontend's version — a URL
 * the backend answered with "Relation not found".
 */
describe("entity child views", () => {

    const tags: CollectionConfig = {
        slug: "tags",
        name: "Tags",
        table: "tags",
        properties: { id: { type: "number" }, label: { type: "string" } }
    } as unknown as CollectionConfig;

    const posts: CollectionConfig = {
        slug: "posts",
        name: "Posts",
        table: "posts",
        properties: { id: { type: "number" }, title: { type: "string" } },
        relations: [
            {
                kind: "hasMany",
                relationName: "featured_tags",
                target: () => tags,
                foreignKeyOnTarget: "post_id",
                overrides: { name: "Featured tags" }
            }
        ]
    } as unknown as CollectionConfig;

    it("keys the child by the relation, not by the target's slug", () => {
        const registry = new CollectionRegistry([posts, tags]);
        const views = getEntityChildViews(registry.get("posts")!);

        expect(views).toHaveLength(1);
        expect(views[0].key).toBe("featured_tags");
        expect(views[0].collection.slug).toBe("featured_tags");
        expect(views[0].source).toEqual({
            kind: "relation",
            relationKey: "featured_tags",
            mode: "owned",
            targetSlug: "tags"
        });
    });

    it("resolves the same segment through both path grammars", () => {
        const registry = new CollectionRegistry([posts, tags]);

        // The frontend's resolver: segment matched against a child slug.
        expect(registry.resolvePathToCollections("posts/1/featured_tags").finalCollection.slug)
            .toBe("featured_tags");
        // The backend's resolver: segment matched against a relation key. It
        // answers with the data collection, which is the target itself.
        expect(registry.getCollectionByPath("posts/1/featured_tags")?.slug).toBe("tags");

        // And both reject the target-slug form the admin used to build.
        expect(() => registry.resolvePathToCollections("posts/1/tags")).toThrow(/not found/);
        expect(() => registry.getCollectionByPath("posts/1/tags")).toThrow(/not found/);
    });

    it("carries the relation's overrides into the resolved child", () => {
        const registry = new CollectionRegistry([posts, tags]);

        expect(getSubcollections(registry.get("posts")!)[0].name).toBe("Featured tags");
        // Used to come back as plain "Tags": the child was re-looked-up in the
        // global slug map, which returned the un-overridden root collection.
        expect(registry.resolvePathToCollections("posts/1/featured_tags").finalCollection.name)
            .toBe("Featured tags");
    });

    it("keeps two relations to the same target apart", () => {
        const dualPosts: CollectionConfig = {
            slug: "dual_posts",
            name: "Posts",
            table: "dual_posts",
            properties: { id: { type: "number" } },
            relations: [
                {
    kind: "hasMany", relationName: "featured_tags", target: () => tags, foreignKeyOnTarget: "featured_post_id" },
                {
    kind: "hasMany", relationName: "archived_tags", target: () => tags, foreignKeyOnTarget: "archived_post_id" }
            ]
        } as unknown as CollectionConfig;

        const registry = new CollectionRegistry([dualPosts, tags]);
        const views = getEntityChildViews(registry.get("dual_posts")!);

        // Both used to collapse to slug "tags" — same tab id, same URL, and the
        // second relation was unreachable.
        expect(views.map(v => v.key)).toEqual(["featured_tags", "archived_tags"]);
        expect(new Set(views.map(v => v.collection.slug)).size).toBe(2);
    });

    it("follows the relation's own target, not a root collection sharing its name", () => {
        const notes: CollectionConfig = {
            slug: "notes", name: "Notes", table: "notes", properties: { id: { type: "number" } }
        } as unknown as CollectionConfig;
        const people: CollectionConfig = {
            slug: "people", name: "People", table: "people", properties: { id: { type: "number" } }
        } as unknown as CollectionConfig;
        const docs: CollectionConfig = {
            slug: "docs", name: "Docs", table: "docs",
            properties: { id: { type: "number" } },
            relations: [
                // Named "people", targets `notes`.
                {
    kind: "hasMany", relationName: "people", target: () => notes, foreignKeyOnTarget: "doc_id" }
            ]
        } as unknown as CollectionConfig;

        const registry = new CollectionRegistry([docs, notes, people]);

        // Used to answer "people" — an unrelated collection, whose callbacks and
        // properties a nested write would then have run against.
        expect(registry.getCollectionByPath("docs/1/people")?.slug).toBe("notes");
    });

    it("marks a junction-backed relation as linked, not owned", () => {
        const linkedPosts: CollectionConfig = {
            slug: "linked_posts",
            name: "Posts",
            table: "linked_posts",
            properties: { id: { type: "number" } },
            relations: [
                {
                    kind: "manyToMany",
                    relationName: "tags",
                    target: () => tags,
                    through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" }
                }
            ]
        } as unknown as CollectionConfig;

        const registry = new CollectionRegistry([linkedPosts, tags]);
        const views = getEntityChildViews(registry.get("linked_posts")!);

        expect(views[0].source).toEqual({
            kind: "relation",
            relationKey: "tags",
            mode: "linked",
            targetSlug: "tags"
        });
    });

    it("names the collection the linked rows actually live in", () => {
        const linkedPosts: CollectionConfig = {
            slug: "linked_posts_2", name: "Posts", table: "linked_posts_2",
            properties: { id: { type: "number" } },
            relations: [
                {
                    // Named differently from its target, which is the case the
                    // picker has to get right: the tab addresses the parent's
                    // set, the picker addresses the whole collection.
                    relationName: "featured_tags",
                    target: () => tags,
                    cardinality: "many",
                    direction: "owning",
                    through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" }
                }
            ]
        } as unknown as CollectionConfig;

        const registry = new CollectionRegistry([linkedPosts, tags]);
        const view = getEntityChildViews(registry.get("linked_posts_2")!)[0];

        expect(view.key).toBe("featured_tags");
        expect(view.source).toMatchObject({ mode: "linked",
targetSlug: "tags" });
    });

    it("does not give a relation nested inside a map a tab of its own", () => {
        const withMap: CollectionConfig = {
            slug: "with_map", name: "With map", table: "with_map",
            properties: {
                id: { type: "number" },
                metadata: {
                    type: "map",
                    properties: {
                        // Declared as a field of `metadata`, not as a list on the
                        // record. Normalization hoists it into `relations` so the
                        // nested property can be stamped, which used to hand it a
                        // top-level tab keyed by the inner property key.
                        related_tags: {
                            type: "relation",
                            relation: {
                                kind: "hasMany",
                                target: () => tags,
                                foreignKeyOnTarget: "with_map_id",
                            }
                        }
                    }
                }
            }
        } as unknown as CollectionConfig;

        const registry = new CollectionRegistry([withMap, tags]);

        expect(getEntityChildViews(registry.get("with_map")!)).toEqual([]);
    });

    it("still gives a tab to a relation declared at the top level and reused in a map", () => {
        const both: CollectionConfig = {
            slug: "both", name: "Both", table: "both",
            properties: {
                id: { type: "number" },
                related_tags: {
                    type: "relation",
                    relation: {
                        kind: "hasMany",
                        target: () => tags,
                        foreignKeyOnTarget: "both_id",
                    }
                },
                metadata: {
                    type: "map",
                    properties: {
                        related_tags: {
                            type: "relation",
                            relation: {
                                kind: "hasMany",
                                target: () => tags,
                                foreignKeyOnTarget: "both_id",
                            }
                        }
                    }
                }
            }
        } as unknown as CollectionConfig;

        const registry = new CollectionRegistry([both, tags]);

        expect(getEntityChildViews(registry.get("both")!).map(v => v.key)).toEqual(["related_tags"]);
    });

    it("leaves a Firestore subcollection as containment, under its own slug", () => {
        const locales: CollectionConfig = {
            slug: "locales", name: "Locales", engine: "firestore",
            properties: { id: { type: "string" } }
        } as unknown as CollectionConfig;
        const sites: CollectionConfig = {
            slug: "sites", name: "Sites", engine: "firestore",
            properties: { id: { type: "string" } },
            subcollections: () => [locales]
        } as unknown as CollectionConfig;

        const views = getEntityChildViews(sites);

        expect(views).toHaveLength(1);
        expect(views[0].key).toBe("locales");
        expect(views[0].collection.slug).toBe("locales");
        expect(views[0].source).toEqual({ kind: "subcollection" });
    });
});
