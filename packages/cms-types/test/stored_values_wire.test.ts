import { type CollectionConfig, EntityReference, EntityRelation, GeoPoint, Vector } from "@rebasepro/cms-types";
import { wrapAsEntityData } from "@rebasepro/common";
import type { FindParams } from "@rebasepro/types";
import { collectionEntityDataOptions } from "../src/data/collection_view_model";
import { sdkClient } from "./helpers/inert-driver";

/**
 * What the admin sends for a row of its view model: the values its data layer
 * hands `client.data` on a create or an update (`storedValuesOf`, then
 * `wireValuesOf` — what `wrapAsEntityData` applies), as the request body
 * carries them (`JSON.stringify`). The server stores exactly these
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
            stamps: { type: "array", of: { type: "date" } }
        }
    };
    const collections = new Map<string, CollectionConfig>([["posts", posts], ["authors", authors], ["tags", tags]]);
    const resolve = (slug: string) => collections.get(slug);
    const sent = (values: Record<string, unknown>): unknown => {
        const options = collectionEntityDataOptions(resolve);
        const stored = options.storedValuesOf?.("posts") ?? ((v: Record<string, unknown>) => v);
        const wire = options.wireValuesOf?.("posts") ?? ((v: Record<string, unknown>) => v);
        return JSON.parse(JSON.stringify(wire(stored(values))));
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
        // A reference (a pointer into another data source) is sent as its id.
        owner: new EntityReference({ id: "7", path: "authors" })
    };

    it("the wire values the REST API documents: keys, numbers, plain points, ISO instants", () => {
        expect(sent(VIEW_MODEL)).toEqual({
            title: "first",
            publishedAt: "2026-11-08T09:30:00.000Z",
            author: 7,
            tags: [1, 2],
            embedding: [0.5, 1],
            place: { latitude: 41.4, longitude: 2.17 },
            meta: { when: "2026-01-02T03:04:05.000Z", spot: { latitude: 1.5, longitude: 2.5 } },
            stamps: ["2026-01-02T10:00:00.000Z"],
            owner: "7"
        });
    });

    it("sends no class instance: what is queued offline is what is sent", () => {
        const options = collectionEntityDataOptions(resolve);
        const values = options.wireValuesOf?.("posts")?.(options.storedValuesOf?.("posts")?.(VIEW_MODEL) ?? VIEW_MODEL);
        expect(values).toEqual(sent(VIEW_MODEL));
    });

    it("a relation the panel holds as a plain ref or `{ id }`, and a link carrying a `_pivot`", () => {
        expect(sent({
            author: { __type: "relation", id: 3, path: "authors" },
            tags: [{ id: 1 }, { id: 2, _pivot: { weight: 4 } }, 5]
        })).toEqual({ author: 3, tags: [1, { id: 2, _pivot: { weight: 4 } }, 5] });
    });

    it("null clears, and a value of an undeclared key is still converted", () => {
        expect(sent({ author: null, publishedAt: null, extra: { at: new Date("2026-01-01T00:00:00.000Z"), p: new GeoPoint(1, 2) } }))
            .toEqual({ author: null, publishedAt: null, extra: { at: "2026-01-01T00:00:00.000Z", p: { latitude: 1, longitude: 2 } } });
    });

    it("a filter by a relation sends the related row's key", () => {
        const convert = collectionEntityDataOptions(resolve).wireFilterValueOf?.("posts");
        expect(convert?.(new EntityRelation(7, "authors"))).toBe(7);
        expect(convert?.(new EntityReference({ id: "u1", path: "users" }))).toBe("u1");
        expect(convert?.({ __type: "relation", id: 9, path: "authors" })).toBe(9);
        expect(convert?.("published")).toBe("published");
    });

    it("every write and read through the admin boundary (`wrapAsEntityData`) sends wire values", async () => {
        const writes: unknown[] = [];
        const reads: unknown[] = [];
        const row = { id: 1, title: "first" };
        const client = sdkClient({
            create: async (values) => { writes.push(values); return row; },
            update: async (_id, values) => { writes.push(values); return row; },
            createMany: async (rows) => { writes.push(...rows); return rows.map(() => row); },
            find: async (params?: FindParams) => { reads.push(params); return { data: [row], meta: { total: 1, limit: 50, offset: 0, hasMore: false } }; },
            count: async (params?: FindParams) => { reads.push(params); return 1; }
        });
        const data = wrapAsEntityData({ table: () => client }, collectionEntityDataOptions(resolve));
        const posts = data.table("posts");
        await posts.create({ author: new EntityRelation(7, "authors"), embedding: new Vector([1, 2]) });
        await posts.update(1, { place: new GeoPoint(1, 2), publishedAt: new Date("2026-01-01T00:00:00.000Z") });
        await posts.createMany?.([{ tags: [new EntityRelation(1, "tags")] }]);
        expect(writes).toEqual([
            { author: 7, embedding: [1, 2] },
            { place: { latitude: 1, longitude: 2 }, publishedAt: "2026-01-01T00:00:00.000Z" },
            { tags: [1] }
        ]);
        await posts.find({ where: { author: ["==", new EntityRelation(7, "authors")], tags: ["array-contains-any", [new EntityRelation(1, "tags")]] } });
        await posts.count?.({ logical: { type: "or", conditions: [{ column: "author", operator: "==", value: new EntityRelation(8, "authors") }] } });
        expect(reads).toEqual([
            { where: { author: ["==", 7], tags: ["array-contains-any", [1]] } },
            { logical: { type: "or", conditions: [{ column: "author", operator: "==", value: 8 }] } }
        ]);
    });
});
