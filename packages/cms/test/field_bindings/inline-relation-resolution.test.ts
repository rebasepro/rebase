import type { CollectionConfig, RelationProperty } from "@rebasepro/types";
import { resolveRelationProperty } from "@rebasepro/common";

/**
 * A relation declared inline on the property is resolvable.
 *
 * `RelationFieldBinding` demanded a top-level `relations` array before it would
 * render, and the inline form — `relation: { kind, target }` on the property,
 * which is what the docs show and what `defineCollection` completes to —
 * produces no such array. Every collection using it threw
 * *"expected a collection with relations support"* and rendered the error
 * boundary where the field should be. Four of the demo app's collections do it
 * that way; nothing in any suite noticed, because no test rendered one.
 *
 * The guard was also redundant. `resolveRelationProperty` handles all three
 * forms and reports a real error naming the property and the collection when it
 * genuinely cannot resolve — which is what this pins.
 */
const authors: CollectionConfig = {
    slug: "authors",
    name: "Authors",
    table: "authors",
    properties: { name: { name: "Name", type: "string" } }
};

describe("resolveRelationProperty", () => {

    it("resolves a relation declared inline, with no `relations` array in sight", () => {
        const posts = {
            slug: "posts",
            name: "Posts",
            table: "posts",
            properties: {}
        } as CollectionConfig;
        expect("relations" in posts).toBe(false);

        const property: RelationProperty = {
            name: "Author",
            type: "relation",
            relation: { kind: "belongsTo", target: () => authors }
        };

        const resolved = resolveRelationProperty(property, posts, "author");
        expect(resolved.cardinality).toBe("one");
        expect(resolved.relationName).toBe("author");
    });

    it("resolves one named in the collection's `relations` array", () => {
        const posts = {
            slug: "posts",
            name: "Posts",
            table: "posts",
            properties: {},
            relations: [
                { kind: "belongsTo", target: () => authors, relationName: "author" }
            ]
        } as unknown as CollectionConfig;

        const property: RelationProperty = { name: "Author", type: "relation" };
        const resolved = resolveRelationProperty(property, posts, "author");
        expect(resolved.relationName).toBe("author");
    });

    it("names the property and the collection when it truly cannot resolve", () => {
        const posts = {
            slug: "posts",
            name: "Posts",
            table: "posts",
            properties: {}
        } as CollectionConfig;

        const property: RelationProperty = { name: "Author", type: "relation" };
        expect(() => resolveRelationProperty(property, posts, "author"))
            .toThrow(/Relation property 'author' on 'posts'/);
    });
});
