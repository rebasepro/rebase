/**
 * @jest-environment jsdom
 */
import React from "react";
import { act, render } from "@testing-library/react";
import { createBrowserRouter, Outlet, useLocation, useNavigate } from "react-router";
import { RouterProvider } from "react-router/dom";
import type { AdminCollection } from "@rebasepro/cms-types";

/**
 * The table mirrors its filters, sort and search into the address bar with
 * `window.history.replaceState`. It used to pass `{}` as the entry's state,
 * which erased what react-router keeps there — the entry's `idx` and `key`.
 *
 * Browser Back from a record then had no index to compute a delta from, and
 * react-router lets a POP with no delta through without asking any blocker.
 * The writer runs on every mount of a collection view, so every record's
 * unsaved-changes guard was skipped by Back: the edit was dropped with no
 * dialog.
 */

// jsdom has no fetch primitives; the data router builds a Request per navigation.
if (typeof globalThis.Request === "undefined") {
    class TestRequest {
        url: string;
        method: string;
        signal: unknown;
        constructor(url: string, init: { method?: string, signal?: unknown } = {}) {
            this.url = String(url);
            this.method = init.method ?? "GET";
            this.signal = init.signal;
        }
    }
    Object.defineProperty(globalThis, "Request", { value: TestRequest, configurable: true });
}

const mockData = { collection: () => ({ find: () => new Promise(() => undefined) }) };
const mockContext = {};
jest.mock("../../src/hooks", () => ({
    useData: () => mockData,
    useRebaseContext: () => mockContext
}));
jest.mock("../../src/hooks/data/useFetch", () => ({ populateFetchCache: jest.fn() }));

import { useDataTableController } from "../../src/components/common/useDataTableController";
import { NavigationBlockerProvider, useNavigationBlocker } from "../../src/hooks/useNavigationBlocker";

const collection: AdminCollection = {
    slug: "products",
    name: "Products",
    table: "products",
    properties: {},
    sort: [["name", "asc"]]
};

let navigate: ReturnType<typeof useNavigate>;
let currentPath = "";
let blockerState = "";

function List() {
    useDataTableController({ path: "products", collection, updateUrl: true });
    return <div>list</div>;
}

function Record() {
    // A record with unsaved edits: every way out has to be confirmed.
    blockerState = useNavigationBlocker(() => true).state;
    return <div>record</div>;
}

function Shell() {
    currentPath = useLocation().pathname;
    navigate = useNavigate();
    return <NavigationBlockerProvider><Outlet/></NavigationBlockerProvider>;
}

const settle = (ms: number) => act(async () => {
    await new Promise(resolve => setTimeout(resolve, ms));
});

describe("useDataTableController — the history entry it rewrites", () => {

    it("keeps react-router's state on the entry, so Back from a dirty record still asks", async () => {
        window.history.replaceState(null, "", "/c/products");
        const router = createBrowserRouter([{
            path: "/",
            element: <Shell/>,
            children: [
                { path: "c/products", element: <List/> },
                { path: "c/products/:id", element: <Record/> }
            ]
        }]);
        const view = render(<RouterProvider router={router}/>);
        await settle(20);

        // The writer ran (the default sort is in the address bar), and the
        // entry still carries the router's bookkeeping.
        expect(window.location.search).toBe("?__sort=name&__sort_order=asc");
        expect(window.history.state?.idx).toBe(0);

        await act(async () => {
            await navigate("/c/products/1");
        });
        await settle(20);
        expect(currentPath).toBe("/c/products/1");

        await act(async () => {
            window.history.back();
        });
        await settle(100);

        expect(blockerState).toBe("blocked");
        expect(currentPath).toBe("/c/products/1");

        view.unmount();
        router.dispose();
    });
});
