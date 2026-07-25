import { serializeCollections, deserializeCollections } from "../src/types/collection_contract";
import { computeSchemaVersion } from "../src/types/schema_version";
import type { CollectionConfig } from "../src/types/collections";

/**
 * The admin block must not reach a client, and must not move the schema version.
 *
 * Both properties are easy to break by accident and silent when broken: a leaked
 * block just makes the contract payload bigger, and a block inside the hash makes
 * every SDK in every repository report itself stale the next time somebody changes
 * an icon.
 */

const collection = (admin: Record<string, unknown> | undefined): CollectionConfig =>
    ({
        slug: "posts",
        name: "Posts",
        table: "posts",
        properties: {
            title: { name: "Title", type: "string" }
        },
        ...(admin ? { admin } : {})
    }) as unknown as CollectionConfig;

describe("the admin block and the wire", () => {
    it("is dropped from a serialized collection", () => {
        const [serialized] = serializeCollections([
            collection({ icon: "FileText", listProperties: ["title"] })
        ]) as Record<string, unknown>[];

        expect(serialized).toBeDefined();
        expect(serialized.admin).toBeUndefined();
        // The rest of the collection is untouched.
        expect(serialized.slug).toBe("posts");
        expect(serialized.properties).toEqual({ title: { name: "Title", type: "string" } });
    });

    it("does not leave an empty husk behind", () => {
        const [serialized] = serializeCollections([collection({})]) as Record<string, unknown>[];
        expect("admin" in serialized).toBe(false);
    });

    it("is dropped from child collections too, not just the top level", () => {
        const parent = {
            slug: "authors",
            name: "Authors",
            table: "authors",
            properties: { name: { name: "Name", type: "string" } },
            admin: { icon: "User" },
            subcollections: [collection({ icon: "FileText" })]
        } as unknown as CollectionConfig;

        const [serialized] = serializeCollections([parent]) as Record<string, unknown>[];
        expect(serialized.admin).toBeUndefined();
        const children = serialized.subcollections as Record<string, unknown>[];
        expect(children).toHaveLength(1);
        expect(children[0].admin).toBeUndefined();
        expect(children[0].slug).toBe("posts");
    });

    it("does not mutate the collection it was given", () => {
        const source = collection({ icon: "FileText" });
        serializeCollections([source]);
        // The panel holds the same object; serializing for the wire must not
        // strip its presentation out from under it.
        expect((source as unknown as Record<string, unknown>).admin).toEqual({ icon: "FileText" });
    });

    it("survives a round trip as absent rather than as null", () => {
        const [rehydrated] = deserializeCollections(
            serializeCollections([collection({ icon: "FileText" })]) as unknown[]
        );
        expect("admin" in (rehydrated as object)).toBe(false);
    });
});

describe("the admin block and the schema version", () => {
    it("does not change when only the admin block changes", () => {
        const before = computeSchemaVersion([collection({ icon: "FileText" })]);
        const after = computeSchemaVersion([
            collection({
                icon: "ShoppingCart",
                listProperties: ["title"],
                defaultViewMode: "kanban",
                sideDialogWidth: 900
            })
        ]);
        expect(after).toBe(before);
    });

    it("is identical whether the block is present or absent", () => {
        expect(computeSchemaVersion([collection(undefined)]))
            .toBe(computeSchemaVersion([collection({ icon: "FileText" })]));
    });

    it("still changes when a property changes", () => {
        const base = computeSchemaVersion([collection({ icon: "FileText" })]);
        const withNewProperty = computeSchemaVersion([
            {
                slug: "posts",
                name: "Posts",
                table: "posts",
                properties: {
                    title: { name: "Title", type: "string" },
                    views: { name: "Views", type: "number" }
                },
                admin: { icon: "FileText" }
            } as unknown as CollectionConfig
        ]);
        expect(withNewProperty).not.toBe(base);
    });
});
