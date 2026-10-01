import React from "react";
import { render, act } from "@testing-library/react";
import { RebaseApiError } from "@rebasepro/types";
import { useFetch } from "../src/hooks/data/useFetch";
import { useCollection } from "../src/hooks/data/useCollection";

/**
 * A realtime outage is not a broken record.
 *
 * Once the socket has been down for a while the SDK tells every live
 * subscription `CONNECTION_LOST` through `onError`, and keeps the subscription:
 * its next `onUpdate`, when the socket is back, is the recovery. These hooks
 * treated every `onError` as "the data is gone" — `useFetch` dropped the entity,
 * which unmounts an open edit form and everything typed into it, and
 * `useCollection` emptied the list — over a connection that was coming back.
 */

jest.mock("../src/hooks/data/useData", () => ({
    useData: () => (globalThis as any).__mockDataClient
}));

jest.mock("../src/hooks/useRebaseContext", () => ({
    useRebaseContext: () => ({})
}));

jest.mock("../src/components/SchemaDriftBanner", () => ({
    useSchemaDriftContext: () => ({ reportSchemaDrift: jest.fn() }),
    isSchemaDriftError: () => false
}));

type Handlers = { onUpdate: (value: any) => void; onError: (error: Error) => void };

function mockLiveClient() {
    const live: { byId?: Handlers; list?: Handlers } = {};
    (globalThis as any).__mockDataClient = {
        collection: () => ({
            find: () => Promise.resolve({ data: [], meta: { hasMore: false } }),
            findById: () => Promise.resolve(undefined),
            listen: (_params: unknown, onUpdate: Handlers["onUpdate"], onError: Handlers["onError"]) => {
                live.list = { onUpdate, onError };
                return () => undefined;
            },
            listenById: (_id: unknown, onUpdate: Handlers["onUpdate"], onError: Handlers["onError"]) => {
                live.byId = { onUpdate, onError };
                return () => undefined;
            }
        })
    };
    return live;
}

const connectionLost = () => new RebaseApiError("The realtime connection is down", { code: "CONNECTION_LOST" });
const collection = { slug: "posts", properties: {} } as any;

describe("a realtime outage", () => {
    afterEach(() => {
        delete (globalThis as any).__mockDataClient;
    });

    it("leaves a loaded record — and the form showing it — in place", async () => {
        const live = mockLiveClient();
        const state: { current?: ReturnType<typeof useFetch> } = {};
        function Probe() {
            state.current = useFetch({ path: "posts", entityId: "outage-1", collection });
            return null;
        }
        render(<Probe/>);
        await act(async () => { live.byId!.onUpdate({ id: "outage-1", path: "posts", values: { title: "Draft" } }); });
        expect(state.current!.entity?.values.title).toBe("Draft");

        await act(async () => { live.byId!.onError(connectionLost()); });

        expect(state.current!.entity?.values.title).toBe("Draft");
        expect(state.current!.dataLoadingError).toBeUndefined();
    });

    it("still reports a connection that was lost before anything loaded", async () => {
        const live = mockLiveClient();
        const state: { current?: ReturnType<typeof useFetch> } = {};
        function Probe() {
            state.current = useFetch({ path: "posts", entityId: "outage-2", collection });
            return null;
        }
        render(<Probe/>);

        await act(async () => { live.byId!.onError(connectionLost()); });

        expect(state.current!.dataLoading).toBe(false);
        expect(state.current!.dataLoadingError).toBeDefined();
    });

    it("leaves a loaded list in place, and the recovery update replaces it", async () => {
        const live = mockLiveClient();
        const state: { current?: ReturnType<typeof useCollection> } = {};
        function Probe() {
            state.current = useCollection({ path: "posts", collection });
            return null;
        }
        render(<Probe/>);
        await act(async () => { live.list!.onUpdate({ data: [{ id: "1", values: {} }], meta: { hasMore: false } }); });
        expect(state.current!.data).toHaveLength(1);

        await act(async () => { live.list!.onError(connectionLost()); });
        expect(state.current!.data).toHaveLength(1);
        expect(state.current!.dataLoadingError).toBeUndefined();

        await act(async () => { live.list!.onUpdate({ data: [{ id: "1", values: {} }, { id: "2", values: {} }], meta: { hasMore: false } }); });
        expect(state.current!.data).toHaveLength(2);
    });

    it("any other error still replaces the list", async () => {
        const live = mockLiveClient();
        const state: { current?: ReturnType<typeof useCollection> } = {};
        function Probe() {
            state.current = useCollection({ path: "posts", collection });
            return null;
        }
        render(<Probe/>);
        await act(async () => { live.list!.onUpdate({ data: [{ id: "1", values: {} }], meta: { hasMore: false } }); });

        await act(async () => { live.list!.onError(new RebaseApiError("Forbidden", { code: "FORBIDDEN" })); });

        expect(state.current!.data).toHaveLength(0);
        expect(state.current!.dataLoadingError).toBeDefined();
    });
});
