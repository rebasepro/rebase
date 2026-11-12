import { serializeCollections, deserializeCollections } from "../src/types/collection_contract";
import type { CollectionConfig } from "../src/types/collections";

/**
 * The admin block must not reach a client.
 *
 * Easy to break by accident and silent when broken: a leaked block just makes the
 * contract payload bigger. (The schema version is computed from table
 * descriptors, which carry no admin block at all — see schema_version.test.ts.)
 */

const collection = (admin: Record<string, unknown> | undefined): CollectionConfig => ({
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        title: { name: "Title", type: "string" }
    },
    ...(admin ? { admin } : {})
});

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
        // A typed collection declares its children as a thunk, which never
        // reaches the wire. An array is the JSON shape — a collection that came
        // back from a contract payload or the collection editor — so the parent
        // is built the way such a collection is: from untyped data.
        const [parent] = deserializeCollections([{
            slug: "authors",
            name: "Authors",
            table: "authors",
            properties: { name: { name: "Name", type: "string" } },
            admin: { icon: "User" },
            subcollections: [collection({ icon: "FileText" })]
        }]);

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
        expect(source.admin).toEqual({ icon: "FileText" });
    });

    it("survives a round trip as absent rather than as null", () => {
        const [rehydrated] = deserializeCollections(
            serializeCollections([collection({ icon: "FileText" })]) as unknown[]
        );
        expect("admin" in (rehydrated as object)).toBe(false);
    });
});
