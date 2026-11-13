import { EntityReference, EntityRelation, GeoPoint, Vector } from "@rebasepro/types";
import { type CollectionConfig } from "@rebasepro/cms-types";
import { collectionEntityDataOptions } from "../src/data/collection_view_model";

/**
 * What the admin sends for a row of its view model: the values its data layer
 * hands `client.data` on a create or an update, as the request body carries
 * them (`JSON.stringify`). The server stores exactly these
 * (`server-postgres/test/wire-write-values.test.ts` pins the stored rows).
 */
describe("the admin's view model, as a write sends it", () => {
    const authors: CollectionConfig = { slug: "authors", name: "authors", properties: { id: { type: "number", isId: true }, name: { type: "string" } } };
    const tags: CollectionConfig = { slug: "tags", name: "tags", properties: { id: { type: "number", isId: true }, label: { type: "string" } } };
    const posts: CollectionConfig = {
        slug: "posts", name: "posts",
        properties: {
            id: { type: "number", isId: true },
            title: { type: "string" },
            publishedAt: { type: "date" },
            author: { type: "relation", relation: { kind: "belongsTo", target: () => authors, localKey: "author_id" } },
            tags: { type: "relation", relation: { kind: "manyToMany", target: () => tags, through: { table: "post_tags", sourceColumn: "post_id", targetColumn: "tag_id" } } },
            embedding: { type: "vector", dimensions: 2 },
            place: { type: "geopoint" },
            meta: { type: "map", properties: { when: { type: "date" }, spot: { type: "geopoint" } } },
            stamps: { type: "array", of: { type: "date" } },
            owner: { type: "reference", path: "authors" }
        }
    };
    const collections = new Map<string, CollectionConfig>([["posts", posts], ["authors", authors], ["tags", tags]]);
    const resolve = (slug: string) => collections.get(slug);
    const sent = (values: Record<string, unknown>): unknown => {
        const options = collectionEntityDataOptions(resolve);
        const stored = options.storedValuesOf?.("posts") ?? ((v: Record<string, unknown>) => v);
        return JSON.parse(JSON.stringify(stored(values)));
    };

    const VIEW_MODEL = {
        title: "first",
        publishedAt: new Date("2026-11-08T09:30:00.000Z"),
        author: new EntityRelation(7, "authors", { id: 7, path: "authors", values: { id: 7, name: "Ada" } }),
        tags: [new EntityRelation(1, "tags"), new EntityRelation(2, "tags", { id: 2, path: "tags", values: { id: 2, label: "red" } })],
        embedding: new Vector([0.5, 1]),
        place: new GeoPoint(41.4, 2.17),
        meta: { when: new Date("2026-01-02T03:04:05.000Z"), spot: new GeoPoint(1.5, 2.5) },
        stamps: [new Date("2026-01-02T10:00:00.000Z")],
        owner: new EntityReference({ id: "7", path: "authors" })
    };

    it("today: the view model's own JSON, which the server unwraps", () => {
        expect(sent(VIEW_MODEL)).toEqual({
            title: "first",
            publishedAt: "2026-11-08T09:30:00.000Z",
            author: { __type: "relation", id: 7, path: "authors", data: { id: 7, path: "authors", values: { id: 7, name: "Ada" } } },
            tags: [
                { __type: "relation", id: 1, path: "tags" },
                { __type: "relation", id: 2, path: "tags", data: { id: 2, path: "tags", values: { id: 2, label: "red" } } }
            ],
            embedding: { value: [0.5, 1] },
            place: { latitude: 41.4, longitude: 2.17 },
            meta: { when: "2026-01-02T03:04:05.000Z", spot: { latitude: 1.5, longitude: 2.5 } },
            stamps: ["2026-01-02T10:00:00.000Z"],
            owner: { __type: "reference", id: "7", path: "authors" }
        });
    });
});
