/**
 * @jest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { EntityRelation, type ByIdReadOptions, type Entity } from "@rebasepro/types";

/**
 * A record opened by URL — a shared link, a reload, a bookmark — has nothing in
 * the cache to open on: the form is built from what the record's own read
 * delivers. That read took no `include`, so a to-many relation was absent from
 * it; the form showed the many-to-many field empty, and a tag added to it was
 * saved as the whole set (`tags: [new]`). A many-to-many save sets membership:
 * every stored tag was unlinked.
 *
 * The record's read now names the collection's relation properties, exactly as
 * the list read does, on the live path and the one-shot one alike.
 */

const STORED: Entity = {
    id: "1", path: "posts",
    values: { title: "T", headId: 2, head: new EntityRelation(2, "people"), tags: [new EntityRelation(1, "tags"), new EntityRelation(2, "tags")] }
};

/** The record as a read with `options` returns it: relations only when named. */
function read(options?: ByIdReadOptions): Entity {
    const named = Array.isArray(options?.include) ? options.include : [];
    const { tags, ...rest } = STORED.values;
    return { ...STORED, values: named.includes("tags") || named.includes("*") ? { ...rest, tags } : rest };
}

let live = true;
const mockClient = {
    collection: () => live
        ? {
            listenById: (_id: string, onUpdate: (entity: Entity | undefined) => void, _onError?: unknown, options?: ByIdReadOptions) => {
                queueMicrotask(() => onUpdate(read(options)));
                return () => undefined;
            }
        }
        : { findById: async (_id: string, options?: ByIdReadOptions) => read(options) }
};
jest.mock("../../src/hooks/data/useData", () => ({ useData: () => mockClient }));
jest.mock("../../src/hooks/useRebaseContext", () => ({ useRebaseContext: () => ({}) }));

import { clearFetchCache, useFetch } from "../../src/hooks/data/useFetch";

const tags = { slug: "tags", name: "Tags", properties: { name: { type: "string", name: "Name" } } };
const people = { slug: "people", name: "People", properties: { name: { type: "string", name: "Name" } } };
const collection = {
    slug: "posts",
    name: "Posts",
    properties: {
        title: { type: "string", name: "Title" },
        head: { type: "relation", name: "Head", relation: { kind: "belongsTo", target: () => people, localKey: "head_id" } },
        tags: { type: "relation", name: "Tags", relation: { kind: "manyToMany", target: () => tags } }
    }
} as never;

describe("a record opened by URL, with nothing cached", () => {
    beforeEach(() => clearFetchCache());

    it("is delivered by its listener with its many-to-many values", async () => {
        live = true;
        const { result } = renderHook(() => useFetch({ path: "posts", entityId: "1", collection }));
        await waitFor(() => expect(result.current.entity).toBeDefined());
        await act(async () => undefined);
        expect(result.current.entity?.values.tags).toEqual(STORED.values.tags);
    });

    it("is read with them too where there is no socket", async () => {
        live = false;
        const { result } = renderHook(() => useFetch({ path: "posts", entityId: "1", collection }));
        await waitFor(() => expect(result.current.entity).toBeDefined());
        expect(result.current.entity?.values.tags).toEqual(STORED.values.tags);
    });
});
