import { CollectionConfig, RelationProperty, MapProperty } from "@rebasepro/types";
import { CollectionRegistry } from "../src/collections/CollectionRegistry";

describe("CollectionRegistry Dual-Layer Store", () => {
    it("preserves un-mutated definitions when resolving relations", () => {
        const postsCollection: CollectionConfig = {
            name: "Posts",
            slug: "posts", // `get()` resolves against table or slug!
            table: "posts",
            properties: {
                title: { name: "Title",
type: "string" }
            }
        };

        const rawAuthorsCollection: CollectionConfig = {
            name: "Authors",
            slug: "authors",
            table: "authors",
            properties: {
                author_posts: {
                    name: "Posts",
                    type: "relation",
                    relation: {
                        kind: "hasMany",
                        relationName: "posts_link",
                        target: () => postsCollection,
                        foreignKeyOnTarget: "author_id"
                    }
                },
                map_field: {
                    name: "Map field",
                    type: "map",
                    properties: {
                        nested_relation: {
                            name: "Nested posts",
                            type: "relation",
                            relation: {
                                kind: "hasMany",
                                relationName: "nested_posts_link",
                                target: () => postsCollection,
                                foreignKeyOnTarget: "author_id"
                            }
                        }
                    }
                }
            }
        };

        const registry = new CollectionRegistry([postsCollection, rawAuthorsCollection]);

        // 1. The normalized registry should inject the resolved relation directly onto the property
        const normalizedAuthors = registry.get("authors");
        expect(normalizedAuthors).toBeDefined();
        const authorPostsField = normalizedAuthors!.properties.author_posts as RelationProperty;
        expect(authorPostsField.resolvedRelation).toBeDefined();
        expect(authorPostsField.resolvedRelation!.targetSlug).toBe("posts");

        const nestedField = normalizedAuthors!.properties.map_field as MapProperty;
        expect((nestedField.properties!.nested_relation as RelationProperty).resolvedRelation).toBeDefined();

        // 2. The raw registry should not be mutated! It must exactly match the initial input.
        const pristineAuthors = registry.getRaw("authors");
        expect(pristineAuthors).toBeDefined();
        const pristinePostsField = pristineAuthors!.properties.author_posts as RelationProperty;
        expect(pristinePostsField.resolvedRelation).toBeUndefined();

        const pristineNestedField = pristineAuthors!.properties.map_field as MapProperty;
        expect((pristineNestedField.properties!.nested_relation as RelationProperty).resolvedRelation).toBeUndefined();

        // 3. getRawCollections array should also be protected
        const pristineArr = registry.getRawCollections().find(c => c.name === "Authors");
        const pristineArrField = pristineArr!.properties.author_posts as RelationProperty;
        expect(pristineArrField.resolvedRelation).toBeUndefined();
    });
});
