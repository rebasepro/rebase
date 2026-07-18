import React from "react";
import { render, act } from "@testing-library/react";
import { useCollection } from "../src/hooks/data/useCollection";

/**
 * `useCollection` owns the flag the collection view renders its spinner from.
 * The SDK-level guarantee — a subscribe that never lands reports an error
 * instead of going quiet — only matters if it actually clears `dataLoading`
 * here, so these drive the hook rather than the transport.
 */

jest.mock("../src/hooks/data/useData", () => ({
    useData: () => (globalThis as any).__mockDataClient
}));

jest.mock("../src/components/SchemaDriftBanner", () => ({
    useSchemaDriftContext: () => ({ reportSchemaDrift: jest.fn() }),
    isSchemaDriftError: () => false
}));

type ListenArgs = {
    onUpdate: (res: any) => void;
    onError: (error: Error) => void;
};

/** A data client whose `listen` hands control of the callbacks to the test. */
function mockClientWithListen() {
    const captured: ListenArgs[] = [];
    (globalThis as any).__mockDataClient = {
        collection: () => ({
            listen: (_params: any, onUpdate: any, onError: any) => {
                captured.push({ onUpdate, onError });
                return () => {};
            }
        })
    };
    return captured;
}

const collection = { slug: "products", properties: {} } as any;

function renderHook() {
    const state: { current?: ReturnType<typeof useCollection> } = {};
    function Probe() {
        state.current = useCollection({ path: "products", collection });
        return null;
    }
    render(<Probe/>);
    return state;
}

describe("useCollection loading state", () => {
    afterEach(() => {
        delete (globalThis as any).__mockDataClient;
    });

    it("starts out loading", () => {
        mockClientWithListen();
        const state = renderHook();
        expect(state.current!.dataLoading).toBe(true);
    });

    it("clears the spinner when rows arrive", () => {
        const listeners = mockClientWithListen();
        const state = renderHook();

        act(() => {
            listeners[0].onUpdate({ data: [{ id: "p1" }], meta: { hasMore: false, total: 1 } });
        });

        expect(state.current!.dataLoading).toBe(false);
        expect(state.current!.data).toHaveLength(1);
        expect(state.current!.dataLoadingError).toBeUndefined();
    });

    it("clears the spinner and surfaces the error when the subscribe fails", () => {
        // This is the path the fix opened up: previously nothing called onError
        // for a subscribe that never landed, so the hook stayed loading forever.
        const listeners = mockClientWithListen();
        const state = renderHook();

        expect(state.current!.dataLoading).toBe(true);

        act(() => {
            listeners[0].onError(new Error("Subscription timed out"));
        });

        expect(state.current!.dataLoading).toBe(false);
        expect(state.current!.dataLoadingError).toBeDefined();
        expect(state.current!.dataLoadingError!.message).toBe("Subscription timed out");
    });

    it("recovers if rows arrive after an error", () => {
        const listeners = mockClientWithListen();
        const state = renderHook();

        act(() => {
            listeners[0].onError(new Error("Subscription timed out"));
        });
        expect(state.current!.dataLoadingError).toBeDefined();

        act(() => {
            listeners[0].onUpdate({ data: [{ id: "p1" }], meta: { hasMore: false, total: 1 } });
        });

        expect(state.current!.dataLoading).toBe(false);
        expect(state.current!.dataLoadingError).toBeUndefined();
        expect(state.current!.data).toHaveLength(1);
    });
});
