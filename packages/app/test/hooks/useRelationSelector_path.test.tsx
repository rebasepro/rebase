import React from "react";
import { render, waitFor } from "@testing-library/react";
import { useRelationSelector } from "../../src/hooks/data/useRelationSelector";
import type { AdminCollection } from "@rebasepro/cms-types";

/**
 * A picker kept mounted while its `path` changes read its options from the
 * new path and handed them out as relations to the old one, so picking one
 * stored a reference to a record of the wrong collection.
 */

jest.mock("../../src/hooks/data/useData", () => ({
    useData: () => (globalThis as { __mockDataClient?: unknown }).__mockDataClient
}));

const collection: AdminCollection = { slug: "targets", name: "Targets", properties: { name: { type: "string" } } };

describe("useRelationSelector — the target path", () => {

    beforeEach(() => {
        (globalThis as { __mockDataClient?: unknown }).__mockDataClient = {
            collection: (path: string) => ({
                find: async () => ({ data: [{ id: `${path}-1`, path, values: { name: `${path} one` } }], meta: { hasMore: false } })
            })
        };
    });

    afterEach(() => {
        delete (globalThis as { __mockDataClient?: unknown }).__mockDataClient;
    });

    it("hands out relations to the collection it read the options from", async () => {
        const state: { current?: ReturnType<typeof useRelationSelector> } = {};
        function Probe({ path }: { path: string }) {
            state.current = useRelationSelector({ path, collection });
            return null;
        }
        const { rerender } = render(<Probe path="authors"/>);
        await waitFor(() => expect(state.current!.items[0]?.id).toBe("authors-1"));
        expect(state.current!.items[0].relation.path).toBe("authors");

        rerender(<Probe path="editors"/>);
        await waitFor(() => expect(state.current!.items[0]?.id).toBe("editors-1"));
        expect(state.current!.items[0].relation.path).toBe("editors");
    });
});
