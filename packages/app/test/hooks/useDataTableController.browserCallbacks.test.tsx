/**
 * @jest-environment jsdom
 */
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";

/**
 * Which callback block the table runs, and which it must leave alone.
 *
 * It used to run `collection.callbacks.afterRead` — the server's block. On a
 * server-backed collection the server had already applied that same callback
 * before the rows arrived, so every transform ran twice; anything not
 * idempotent (a counter, an appended suffix) compounded. And the bodies of that
 * block are stripped out of the admin bundle by the Vite plugin, so what ran
 * here in dev was not what ran in a build.
 *
 * The panel's own callbacks are `admin.browserCallbacks`, flattened onto the
 * collection by `resolveAdminCollection` before it reaches this hook.
 */

const mockLocation = { pathname: "/c/customers", search: "", hash: "", state: null, key: "k" };
jest.mock("react-router", () => ({ useLocation: () => mockLocation }));

const findMock = jest.fn();
jest.mock("../../src/hooks", () => ({
    useData: () => ({ collection: () => ({ find: findMock }) }),
    useRebaseContext: () => ({ someContextField: true })
}));
jest.mock("../../src/hooks/data/useFetch", () => ({ populateFetchCache: jest.fn() }));

import { useDataTableController } from "../../src/components/common/useDataTableController";

const baseCollection = {
    slug: "customers",
    name: "Customers",
    table: "customers",
    properties: {
        id: { name: "ID", type: "string" },
        email: { name: "Email", type: "string" }
    }
} as any;

const row = { id: "c1", path: "customers", values: { email: "john@acme.com" } };

const render = (collection: any) =>
    renderHook(() => useDataTableController({ path: "customers", collection }));

describe("useDataTableController — afterRead", () => {

    beforeEach(() => {
        mockLocation.search = "";
        findMock.mockReset();
        findMock.mockResolvedValue({ data: [row] });
    });

    it("runs admin.browserCallbacks.afterRead on the rows", async () => {
        const { result } = render({
            ...baseCollection,
            browserCallbacks: {
                afterRead: ({ row }: { row: Record<string, unknown> }) =>
                    ({ ...row, email: "REDACTED" })
            }
        });

        await waitFor(() => expect(result.current.data).toHaveLength(1));
        expect(result.current.data[0].values).toEqual({ id: "c1", email: "REDACTED" });
    });

    it("hands it the flat row and the context, and keeps the entity id", async () => {
        const afterRead = jest.fn(({ row }) => row);
        const { result } = render({ ...baseCollection, browserCallbacks: { afterRead } });

        await waitFor(() => expect(result.current.data).toHaveLength(1));
        expect(afterRead).toHaveBeenCalledWith(expect.objectContaining({
            path: "customers",
            row: { id: "c1", email: "john@acme.com" },
            context: { someContextField: true }
        }));
        expect(result.current.data[0].id).toBe("c1");
    });

    it("does NOT run the server's callbacks.afterRead", async () => {
        // The whole point of the split. Running this here applied the server's
        // transform a second time on a row it had already transformed.
        const serverAfterRead = jest.fn(({ row }) => ({ ...row, email: "MASKED-TWICE" }));
        const { result } = render({ ...baseCollection, callbacks: { afterRead: serverAfterRead } });

        await waitFor(() => expect(result.current.data).toHaveLength(1));
        expect(serverAfterRead).not.toHaveBeenCalled();
        expect(result.current.data[0].values).toEqual({ email: "john@acme.com" });
    });

    it("leaves the rows alone, and still renders them, when afterRead throws", async () => {
        const { result } = render({
            ...baseCollection,
            browserCallbacks: {
                afterRead: () => { throw new Error("boom"); }
            }
        });

        await waitFor(() => expect(result.current.data).toHaveLength(1));
        expect(result.current.data[0].values).toEqual({ email: "john@acme.com" });
        expect(result.current.dataLoading).toBe(false);
    });

    it("passes rows through untouched when neither block is declared", async () => {
        const { result } = render(baseCollection);

        await waitFor(() => expect(result.current.data).toHaveLength(1));
        expect(result.current.data[0].values).toEqual({ email: "john@acme.com" });
    });
});
