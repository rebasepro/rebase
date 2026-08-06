import React from "react";
import { render, act } from "@testing-library/react";
import { useCollection } from "../src/hooks/data/useCollection";

/**
 * Without a websocket the client defines no `listen`, and `useCollection`
 * falls back to a one-shot `find`. That fallback used to return an empty
 * cleanup, so nothing disowned a request whose query had already been replaced
 * — and responses do not arrive in the order they were asked for.
 *
 * The live branch cancels on cleanup; these check the fallback keeps the same
 * promise. See docs/bug-classes.md.
 */

jest.mock("../src/hooks/data/useData", () => ({
    useData: () => (globalThis as any).__mockDataClient
}));

jest.mock("../src/components/SchemaDriftBanner", () => ({
    useSchemaDriftContext: () => ({ reportSchemaDrift: jest.fn() }),
    isSchemaDriftError: () => false
}));

type Pending = {
    searchString?: string;
    resolve: (rows: string[]) => void;
    reject: (error: Error) => void;
};

/**
 * A data client with **no** `listen` — the shape the SDK builds when it has no
 * socket (`if (ws)` guards both live methods). Each `find` is left pending so
 * the test decides what order the answers come back in.
 */
function mockClientWithoutListen() {
    const pending: Pending[] = [];
    (globalThis as any).__mockDataClient = {
        collection: () => ({
            find: (params: any) => new Promise((resolve, reject) => {
                pending.push({
                    searchString: params?.searchString,
                    resolve: (rows: string[]) => resolve({
                        data: rows.map((id) => ({ id,
values: {} })),
                        meta: { hasMore: false }
                    }),
                    reject
                });
            })
        })
    };
    return pending;
}

const collection = { slug: "products", properties: {} } as any;

function renderHook(searchString?: string) {
    const state: { current?: ReturnType<typeof useCollection> } = {};
    function Probe({ search }: { search?: string }) {
        state.current = useCollection({ path: "products",
collection,
searchString: search });
        return null;
    }
    const view = render(<Probe search={searchString}/>);
    return {
        state,
        setSearch: (next: string) => view.rerender(<Probe search={next}/>)
    };
}

describe("useCollection without a socket", () => {
    afterEach(() => {
        delete (globalThis as any).__mockDataClient;
    });

    it("ignores a response whose query has been replaced", async () => {
        const pending = mockClientWithoutListen();
        const { state, setSearch } = renderHook("ab");

        await act(async () => {
            setSearch("abc");
        });
        expect(pending).toHaveLength(2);
        expect(pending[0].searchString).toBe("ab");
        expect(pending[1].searchString).toBe("abc");

        // The current query answers first, the abandoned one afterwards —
        // the ordinary case for a slow filter and a fast one.
        await act(async () => {
            pending[1].resolve(["abc-1"]);
        });
        await act(async () => {
            pending[0].resolve(["ab-1", "ab-2"]);
        });

        expect(state.current!.data.map(e => e.id)).toEqual(["abc-1"]);
    });

    it("ignores an error from a query that has been replaced", async () => {
        const pending = mockClientWithoutListen();
        const { state, setSearch } = renderHook("ab");

        await act(async () => {
            setSearch("abc");
        });
        await act(async () => {
            pending[1].resolve(["abc-1"]);
        });
        await act(async () => {
            pending[0].reject(new Error("the query nobody is waiting for"));
        });

        // A late failure must not blank the rows that are on screen, nor raise
        // an error banner about a search the user has already moved past.
        expect(state.current!.data.map(e => e.id)).toEqual(["abc-1"]);
        expect(state.current!.dataLoadingError).toBeUndefined();
    });
});
