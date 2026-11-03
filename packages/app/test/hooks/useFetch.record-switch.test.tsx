/**
 * @jest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import type { Entity } from "@rebasepro/types";

/**
 * A view that reads one record and is handed another in place — an embedded
 * form panel whose `entityId` changes, a side panel that replaces its contents
 * — kept returning the record it had until the new one's read answered. For
 * that while the new id was shown with the old record's values: as a record
 * still loading when nothing was cached, and as a loaded one when the new
 * record was cached, since nothing put the cached copy on screen.
 */

const listeners = new Map<string, (entity: Entity | undefined) => void>();
const mockClient = {
    collection: () => ({
        listenById: (id: string, onUpdate: (entity: Entity | undefined) => void) => {
            listeners.set(id, onUpdate);
            return () => listeners.delete(id);
        }
    })
};
jest.mock("../../src/hooks/data/useData", () => ({ useData: () => mockClient }));
jest.mock("../../src/hooks/useRebaseContext", () => ({ useRebaseContext: () => ({}) }));

import { clearFetchCache, populateFetchCache, useFetch } from "../../src/hooks/data/useFetch";

const collection = { slug: "posts", name: "Posts", properties: { title: { type: "string", name: "Title" } } } as never;

function record(id: string, title: string): Entity {
    return { id, path: "posts", values: { title } };
}

describe("a record read in place of another", () => {
    beforeEach(() => {
        clearFetchCache();
        listeners.clear();
    });

    async function openFirst() {
        const view = renderHook(({ entityId }: { entityId: string }) => useFetch({ path: "posts", entityId, collection }),
            { initialProps: { entityId: "1" } });
        await act(async () => listeners.get("1")!(record("1", "First")));
        expect(view.result.current.entity?.values.title).toBe("First");
        return view;
    }

    it("is loading, not the previous record, until it is read", async () => {
        const { result, rerender } = await openFirst();

        rerender({ entityId: "2" });

        expect(result.current.entity).toBeUndefined();
        expect(result.current.dataLoading).toBe(true);
        await act(async () => listeners.get("2")!(record("2", "Second")));
        expect(result.current.entity?.values.title).toBe("Second");
    });

    it("is its cached copy at once when there is one", async () => {
        const { result, rerender } = await openFirst();
        populateFetchCache("posts", [record("2", "Second, cached")]);

        rerender({ entityId: "2" });

        expect(result.current.entity?.id).toBe("2");
        expect(result.current.entity?.values.title).toBe("Second, cached");
        expect(result.current.dataLoading).toBe(false);
    });
});
