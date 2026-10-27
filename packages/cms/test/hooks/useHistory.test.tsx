/**
 * @jest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";

// The hook reads only its API base, auth token and the access simulation out
// of `@rebasepro/app`. The config object is hoisted, not rebuilt per call: the
// real one comes from a context and is referentially stable, and the hook's
// fetch callback keys off its identity.
const simulationState: { simulation: { role?: string; userId?: string } | null } = { simulation: null };
jest.mock("@rebasepro/app", () => {
    const apiConfig = { apiUrl: "http://api.test",
        getAuthToken: async () => "token" };
    return {
        useApiBase: () => "http://api.test/api",
        useApiConfig: () => apiConfig,
        useRlsSimulation: () => simulationState
    };
});

import { useHistory } from "../../src/hooks/useHistory";

type Revision = { id: string };

function respondWith(entries: Revision[]) {
    return Promise.resolve({
        ok: true,
        json: async () => ({
            data: entries,
            meta: { total: entries.length,
                limit: 10,
                offset: 0,
                hasMore: false }
        })
    } as Response);
}

describe("useHistory", () => {

    const fetchMock = jest.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        global.fetch = fetchMock as unknown as typeof fetch;
    });

    it("refetches when the record is saved", async () => {
        // A save adds a revision server-side. The panel is open across the
        // save, so nothing remounts — only `refreshToken` changes.
        fetchMock.mockImplementation(() => respondWith([{ id: "create" }]));

        const { result, rerender } = renderHook(
            ({ refreshToken }: { refreshToken: number }) => useHistory({
                slug: "products",
                entityId: "p1",
                refreshToken
            }),
            { initialProps: { refreshToken: 0 } }
        );

        await waitFor(() => expect(result.current.entries).toHaveLength(1));
        expect(fetchMock).toHaveBeenCalledTimes(1);

        fetchMock.mockImplementation(() => respondWith([{ id: "update" }, { id: "create" }]));
        rerender({ refreshToken: 1 });

        await waitFor(() => expect(result.current.entries).toHaveLength(2));
        expect(result.current.entries[0].id).toBe("update");
    });

    it("does not refetch when the token is unchanged", async () => {
        fetchMock.mockImplementation(() => respondWith([{ id: "create" }]));

        const { result, rerender } = renderHook(
            ({ refreshToken }: { refreshToken: number }) => useHistory({
                slug: "products",
                entityId: "p1",
                refreshToken
            }),
            { initialProps: { refreshToken: 0 } }
        );

        await waitFor(() => expect(result.current.entries).toHaveLength(1));

        rerender({ refreshToken: 0 });
        rerender({ refreshToken: 0 });

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("requests the first page again rather than appending after a save", async () => {
        fetchMock.mockImplementation(() => respondWith([{ id: "create" }]));

        const { result, rerender } = renderHook(
            ({ refreshToken }: { refreshToken: number }) => useHistory({
                slug: "products",
                entityId: "p1",
                refreshToken
            }),
            { initialProps: { refreshToken: 0 } }
        );

        await waitFor(() => expect(result.current.entries).toHaveLength(1));

        rerender({ refreshToken: 1 });

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        expect(fetchMock.mock.calls[1][0]).toContain("offset=0");
    });
});

/**
 * Infinite scroll has to reach the oldest revision.
 *
 * `loadMore` refused to fetch once `offset + entries.length` reached the total
 * — but `entries` already holds every page up to `offset`, so the offset was
 * counted twice. With 25 revisions at 10 a page it stopped at 20 while still
 * reporting `hasMore`; at 100 revisions only 60 were reachable.
 */
describe("useHistory — loading more", () => {

    const TOTAL = 25;

    beforeEach(() => {
        global.fetch = jest.fn(async (url: string) => {
            const params = new URL(url).searchParams;
            const limit = Number(params.get("limit"));
            const offset = Number(params.get("offset"));
            const data = Array.from({ length: Math.max(0, Math.min(limit, TOTAL - offset)) },
                (_, i): Revision => ({ id: `h${offset + i}` }));
            return {
                ok: true,
                json: async () => ({ data, meta: { total: TOTAL, limit, offset, hasMore: offset + data.length < TOTAL } })
            } as Response;
        }) as unknown as typeof fetch;
    });

    it("reaches every revision, one page at a time", async () => {
        const { result } = renderHook(() => useHistory({ slug: "posts", entityId: "1", pageSize: 10 }));
        await waitFor(() => expect(result.current.entries).toHaveLength(10));

        act(() => result.current.loadMore());
        await waitFor(() => expect(result.current.entries).toHaveLength(20));

        act(() => result.current.loadMore());
        await waitFor(() => expect(result.current.entries).toHaveLength(25));
        expect(result.current.hasMore).toBe(false);
        expect(result.current.entries.map(e => e.id)).toEqual(Array.from({ length: TOTAL }, (_, i) => `h${i}`));
    });
});

/**
 * While access is simulated, the history is read as the simulated identity.
 * Every data view went through `client.simulate()`; the History tab fetched
 * with the administrator's token alone, and listed versions (and fields) the
 * simulated identity cannot read.
 */
describe("useHistory — while access is simulated", () => {

    const fetchMock = jest.fn((..._args: unknown[]) => respondWith([{ id: "create" }]));

    beforeEach(() => {
        fetchMock.mockClear();
        global.fetch = fetchMock as unknown as typeof fetch;
    });

    afterEach(() => {
        simulationState.simulation = null;
    });

    function headersOf(call: unknown[]): Record<string, string> {
        return ((call[1] as RequestInit | undefined)?.headers ?? {}) as Record<string, string>;
    }

    it("sends the simulation with every history request", async () => {
        simulationState.simulation = { role: "customer", userId: "u42" };
        const { result } = renderHook(() => useHistory({ slug: "posts", entityId: "p1" }));
        await waitFor(() => expect(result.current.entries).toHaveLength(1));

        expect(headersOf(fetchMock.mock.calls[0])).toEqual(expect.objectContaining({
            "x-rebase-simulate-role": "customer",
            "x-rebase-simulate-user-id": "u42"
        }));

        // A revert carries it too, so the server refuses it as the simulated
        // write it would be.
        await act(async () => { await result.current.revert("h1").catch(() => undefined); });
        const revertCall = fetchMock.mock.calls.find(call => String(call[0]).endsWith("/revert"));
        expect(revertCall && headersOf(revertCall)["x-rebase-simulate-role"]).toBe("customer");
    });

    it("sends none when nothing is simulated", async () => {
        const { result } = renderHook(() => useHistory({ slug: "posts", entityId: "p1" }));
        await waitFor(() => expect(result.current.entries).toHaveLength(1));

        expect(Object.keys(headersOf(fetchMock.mock.calls[0])).filter(h => h.startsWith("x-rebase-simulate"))).toEqual([]);
    });
});
