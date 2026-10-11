/**
 * @jest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { EntityRelation, type Entity } from "@rebasepro/types";

/**
 * A record's own listener (`listenById`) never carries a to-many relation: the
 * single-record read takes no `include`, so `tags` is simply absent from every
 * frame. The list row a click puts in the cache does carry it — a list read
 * includes every relation property — and the form opens on that row.
 *
 * Replacing the opened row with the first frame wholesale took `tags` off the
 * screen. The form follows an untouched field to its new value, so the field
 * emptied; a tag added to the now empty field was then saved as the whole set
 * (`tags: [new]`), and a many-to-many save *sets membership* — every other tag
 * was unlinked. A relation a frame did not deliver is not a relation that was
 * cleared: it keeps the value the record was opened with.
 */

type Deliver = (entity: Entity | undefined) => void;
let deliver: Deliver = () => undefined;
const mockClient = {
    collection: () => ({
        listenById: (_id: string, onUpdate: Deliver) => {
            deliver = onUpdate;
            return () => undefined;
        }
    })
};
jest.mock("../../src/hooks/data/useData", () => ({ useData: () => mockClient }));
jest.mock("../../src/hooks/useRebaseContext", () => ({ useRebaseContext: () => ({}) }));

import { clearFetchCache, populateFetchCache, useFetch } from "../../src/hooks/data/useFetch";

const tags = { slug: "tags", name: "Tags", properties: {} };
const people = { slug: "people", name: "People", properties: {} };
const collection = {
    slug: "posts",
    name: "Posts",
    properties: {
        title: { type: "string", name: "Title" },
        head: { type: "relation", name: "Head", relation: { kind: "belongsTo", target: () => people, localKey: "head_id" } },
        tags: { type: "relation", name: "Tags", relation: { kind: "manyToMany", target: () => tags } }
    }
} as never;

const tag = (id: number) => new EntityRelation(id, "tags");

/** The row a list hands over on click: every relation property included. */
const LIST_ROW: Entity = {
    id: "1", path: "posts",
    values: { title: "T", headId: 2, head: new EntityRelation(2, "people"), tags: [tag(1), tag(2)] }
};

/** The same record as its listener delivers it: no to-many relation at all. */
const frame = (values: Record<string, unknown>): Entity => ({ id: "1", path: "posts", values });

function open() {
    return renderHook(() => useFetch({ path: "posts", entityId: "1", collection }));
}

describe("a record opened from a list row, as its listener delivers it", () => {
    beforeEach(() => clearFetchCache());

    it("keeps the to-many relation the frame did not carry", async () => {
        populateFetchCache("posts", [LIST_ROW]);
        const { result } = open();
        expect(result.current.entity?.values.tags).toEqual([tag(1), tag(2)]);

        await act(async () => deliver(frame({ title: "T", headId: 2, head: new EntityRelation(2, "people") })));
        expect(result.current.entity?.values.tags).toEqual([tag(1), tag(2)]);
    });

    it("keeps it across later frames, and takes everything a frame does carry", async () => {
        populateFetchCache("posts", [LIST_ROW]);
        const { result } = open();
        await act(async () => deliver(frame({ title: "T", headId: 2, head: new EntityRelation(2, "people") })));
        await act(async () => deliver(frame({ title: "Edited elsewhere", headId: 3, head: new EntityRelation(3, "people") })));

        expect(result.current.entity?.values).toEqual({
            title: "Edited elsewhere",
            headId: 3,
            head: new EntityRelation(3, "people"),
            tags: [tag(1), tag(2)]
        });
    });

    it("takes a relation a frame delivers, even an empty one", async () => {
        populateFetchCache("posts", [LIST_ROW]);
        const { result } = open();
        await act(async () => deliver(frame({ title: "T", tags: [] })));
        expect(result.current.entity?.values.tags).toEqual([]);
    });

    it("carries nothing into a different record, or past a deletion", async () => {
        populateFetchCache("posts", [LIST_ROW]);
        const { result } = open();
        await act(async () => deliver(undefined));
        expect(result.current.entity).toBeUndefined();
        await act(async () => deliver(frame({ title: "Recreated" })));
        expect(result.current.entity?.values).toEqual({ title: "Recreated" });
    });
});
