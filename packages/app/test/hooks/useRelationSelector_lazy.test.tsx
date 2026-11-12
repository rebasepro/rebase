import React from "react";
import { render, act } from "@testing-library/react";
import { useRelationSelector } from "../../src/hooks/data/useRelationSelector";
import type { AdminCollection } from "@rebasepro/cms-types";
import { type DataTables, fakeTableAccessor, findResponse } from "../helpers/fakes";

/** What the mocked `useData()` hands the hook; each test installs its own. */
let mockDataClient: DataTables | undefined;

/**
 * A mounted picker is not an open picker.
 *
 * The fetch used to run from a bare `useEffect(…, [fetchData])`, so every
 * mounted `RelationSelector` queried — or, where the client has a socket,
 * *subscribed to* — the target collection straight away. The collection table
 * mounts one per visible row, so opening a table with a relation column cost
 * one request or one live subscription per row for data nobody had asked to
 * see, held for as long as the table was mounted.
 *
 * `enabled` is what the caller flips when the popover is first opened. These
 * pin both halves: nothing is asked for until then, and the flip is what asks.
 */

jest.mock("../../src/hooks/data/useData", () => ({
    useData: () => mockDataClient
}));

/** A client that records every list query and every subscription it is given. */
function mockClient({ withSocket }: { withSocket: boolean }) {
    const finds: unknown[] = [];
    const listens: unknown[] = [];
    const unsubscribes: string[] = [];
    mockDataClient = {
        table: (slug) => fakeTableAccessor(slug, {
            find: async (params) => {
                finds.push(params);
                return findResponse([]);
            },
            listen: withSocket
                ? (params) => {
                    listens.push(params);
                    return () => { unsubscribes.push("unsubscribed"); };
                }
                : undefined
        })
    };
    return { finds, listens, unsubscribes };
}

const collection: AdminCollection = { slug: "tags", name: "Tags", properties: { id: { type: "string" } } };

function renderPicker(enabled: boolean) {
    const state: { current?: ReturnType<typeof useRelationSelector> } = {};
    function Probe({ enabled: on }: { enabled: boolean }) {
        state.current = useRelationSelector({ path: "tags", collection, enabled: on });
        return null;
    }
    const view = render(<Probe enabled={enabled}/>);
    return {
        state,
        open: () => view.rerender(<Probe enabled={true}/>)
    };
}

describe("useRelationSelector only fetches when it is enabled", () => {

    afterEach(() => {
        mockDataClient = undefined;
    });

    it("issues no request while disabled", async () => {
        const client = mockClient({ withSocket: false });
        await act(async () => {
            renderPicker(false);
        });
        expect(client.finds).toEqual([]);
    });

    it("opens no subscription while disabled, on the realtime path", async () => {
        // The expensive half: a subscription is held for the lifetime of the
        // cell, not just for the length of a request.
        const client = mockClient({ withSocket: true });
        await act(async () => {
            renderPicker(false);
        });
        expect(client.listens).toEqual([]);
    });

    it("fetches once enabled turns on", async () => {
        const client = mockClient({ withSocket: false });
        const picker = renderPicker(false);
        await act(async () => {
            picker.open();
        });
        expect(client.finds).toHaveLength(1);
    });

    it("reports loading in the frame between being enabled and the first result", async () => {
        // Otherwise the list renders "No relations found." for a paint, which
        // is the same thing it says when the collection really is empty.
        mockClient({ withSocket: false });
        const picker = renderPicker(true);
        expect(picker.state.current!.isLoading).toBe(true);
        await act(async () => undefined);
    });

    it("still fetches on mount when enabled is left unset", async () => {
        // Default stays `true`: this hook is exported and the flag is opt-in.
        const client = mockClient({ withSocket: false });
        function Probe() {
            useRelationSelector({ path: "tags", collection });
            return null;
        }
        await act(async () => {
            render(<Probe/>);
        });
        expect(client.finds).toHaveLength(1);
    });
});
