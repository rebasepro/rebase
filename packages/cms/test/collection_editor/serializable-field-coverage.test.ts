import type { AdminCollection } from "@rebasepro/cms-types";

import { toSerializableCollectionConfig } from "../../src/collection_editor/serializable_utils";

/**
 * The serializable mirror drops whatever it was not told to copy.
 *
 * `toSerializableCollectionConfig` is a hand-written whitelist, and the
 * collection editor round-trips through it on the way to the ts-morph writer.
 * So a field added to the core types and not to the whitelist is not a stale
 * type — it is silently unset the first time a user opens the collection in the
 * panel and saves. Six of them were, and the two that mattered are asserted
 * here by name:
 *
 * - `excludeFromApi`, the server-side guarantee that a password hash never
 *   reaches a response.
 * - `relations`, which had no serializer at all. `buildCollectionFromTableMetadata`
 *   fills it from the imported table's foreign keys and junctions, so importing
 *   a table detected its relations, showed them on the form, and dropped every
 *   one of them on save.
 */
describe("toSerializableCollectionConfig keeps the fields the backend reads", () => {

    const collection = {
        slug: "posts",
        name: "Posts",
        table: "posts",
        strictWrites: false,
        disableDefaultPolicies: true,
        relations: [
            { kind: "belongsTo", target: () => ({ slug: "authors" }), relationName: "author", localKey: "author_id" },
            {
                kind: "manyToMany",
                target: () => ({ slug: "tags" }),
                relationName: "tags",
                through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" }
            }
        ],
        properties: {
            title: { name: "Title", type: "string", url: true },
            password_hash: { name: "Password hash", type: "string", excludeFromApi: true },
            email: {
                name: "Email",
                type: "string",
                admin: { filterOperators: ["==", "ilike"], urlPreview: "image" }
            }
        }
    } as unknown as AdminCollection;

    const serialized = toSerializableCollectionConfig(collection);

    it("keeps the collection-level write and policy flags", () => {
        expect(serialized.strictWrites).toBe(false);
        expect(serialized.disableDefaultPolicies).toBe(true);
    });

    it("keeps relations, with each target resolved to a slug", () => {
        expect(serialized.relations).toHaveLength(2);
        expect(serialized.relations?.[0]).toEqual({
            kind: "belongsTo",
            target: "authors",
            relationName: "author",
            localKey: "author_id"
        });
        expect(serialized.relations?.[1]).toEqual({
            kind: "manyToMany",
            target: "tags",
            relationName: "tags",
            through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" }
        });
    });

    it("keeps excludeFromApi — losing it would publish the column", () => {
        expect(serialized.properties.password_hash).toMatchObject({ excludeFromApi: true });
    });

    it("keeps the core url flag and the admin urlPreview, which are different fields", () => {
        expect(serialized.properties.title).toMatchObject({ url: true });
        expect(serialized.properties.email.admin).toMatchObject({ urlPreview: "image" });
    });

    it("keeps filterOperators, which is plain data", () => {
        expect(serialized.properties.email.admin?.filterOperators).toEqual(["==", "ilike"]);
    });

    it("still drops the component refs, all three of them", () => {
        const withComponents = {
            slug: "posts",
            name: "Posts",
            table: "posts",
            properties: {
                title: {
                    name: "Title",
                    type: "string",
                    admin: {
                        columnWidth: 200,
                        Field: () => null,
                        Preview: () => null,
                        Filter: () => null
                    }
                }
            }
        } as unknown as AdminCollection;

        const admin = toSerializableCollectionConfig(withComponents).properties.title.admin;
        expect(admin).toEqual({ columnWidth: 200 });
    });
});
