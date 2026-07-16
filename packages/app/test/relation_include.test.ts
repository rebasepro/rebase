/**
 * `include` is what makes the REST transport return a collection's relations in
 * the same request as its rows. The realtime transport ignores it and embeds
 * relation data unconditionally, so a gap here is invisible in a normal
 * (websocket) deployment and only shows up as blank relation cells when
 * realtime is off — which is exactly why it needs pinning here.
 */
import { describe, expect, it } from "@jest/globals";
import { CollectionConfig } from "@rebasepro/types";
import { getRelationIncludeParams } from "../src/util/previews";

const collectionWith = (properties: CollectionConfig["properties"]): CollectionConfig =>
    ({ slug: "test",
name: "Test",
properties } as CollectionConfig);

describe("getRelationIncludeParams", () => {

    it("asks for relations when a property is a relation", () => {
        const collection = collectionWith({
            name: { type: "string" },
            author: { type: "relation",
relationName: "author" }
        });
        expect(getRelationIncludeParams(collection)).toEqual(["*"]);
    });

    it("asks for relations when a property is a reference", () => {
        const collection = collectionWith({
            name: { type: "string" },
            owner: { type: "reference",
path: "users" }
        });
        expect(getRelationIncludeParams(collection)).toEqual(["*"]);
    });

    it("asks for relations when a property is an array of relations", () => {
        // Rendered by ArrayOfRelationsPreview, so the data has to arrive with
        // the rows — the previous inline check only looked at top-level types
        // and left these collections fetching one request per cell.
        const collection = collectionWith({
            name: { type: "string" },
            tags: { type: "array",
of: { type: "relation",
relationName: "tags" } }
        });
        expect(getRelationIncludeParams(collection)).toEqual(["*"]);
    });

    it("asks for relations when a property is an array of references", () => {
        const collection = collectionWith({
            name: { type: "string" },
            editors: { type: "array",
of: { type: "reference",
path: "users" } }
        });
        expect(getRelationIncludeParams(collection)).toEqual(["*"]);
    });

    it("stays out of the way when the collection has no relations", () => {
        const collection = collectionWith({
            name: { type: "string" },
            count: { type: "number" },
            tags: { type: "array",
of: { type: "string" } }
        });
        expect(getRelationIncludeParams(collection)).toBeUndefined();
    });

    it("tolerates property builders and a collection with no properties", () => {
        const withBuilder = collectionWith({
            name: { type: "string" },
            computed: (() => ({ type: "string" })) as never
        });
        expect(getRelationIncludeParams(withBuilder)).toBeUndefined();
        expect(getRelationIncludeParams({ slug: "x",
name: "X" } as CollectionConfig)).toBeUndefined();
    });
});
