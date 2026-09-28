/**
 * @jest-environment jsdom
 *
 * Coming back from a record opened full screen lands where the list was left.
 *
 * `#full` replaces the collection view (`RebaseRoute`), so Back mounts a new
 * one. `useDataTableController` keeps the offset and the rows it was over and
 * offers them as `initialScroll` / `onScroll`; the table and card views took
 * them, the list view never did, and every return started at the top.
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";

// jsdom has no ResizeObserver; the list and toolbar observe their own size.
if (typeof globalThis.ResizeObserver === "undefined") {
    class NoopResizeObserver {
        observe() { /* nothing to observe in jsdom */ }
        unobserve() { /* nothing to observe in jsdom */ }
        disconnect() { /* nothing to observe in jsdom */ }
    }
    Object.defineProperty(globalThis, "ResizeObserver", { value: NoopResizeObserver, configurable: true });
}

const onScroll = jest.fn();
const rows = Array.from({ length: 40 }, (_, i) => ({ id: String(i), path: "products", values: { name: `Product ${i}` } }));

jest.mock("@rebasepro/app", () => {
    const tableController = {
        data: rows,
        dataLoading: false,
        noMoreToLoad: true,
        filterValues: undefined,
        setFilterValues: () => undefined,
        sortBy: undefined,
        setSortBy: () => undefined,
        searchString: undefined,
        setSearchString: () => undefined,
        clearFilter: () => undefined,
        itemCount: rows.length,
        setItemCount: () => undefined,
        paginationEnabled: false,
        pageSize: 50,
        checkFilterCombination: () => true,
        setPopupCell: () => undefined,
        initialScroll: 640,
        onScroll
    };
    const overrides: Record<string, unknown> = {
        useTranslation: () => ({ t: (key: string) => key }),
        useData: () => ({ collection: () => ({ count: async () => rows.length, find: async () => ({ data: [] }) }) }),
        useAuthController: () => ({ user: { uid: "u1" } }),
        useRebaseContext: () => ({ authController: { user: { uid: "u1" } } }),
        useUserConfigurationPersistence: () => undefined,
        useAnalyticsController: () => ({}),
        useCustomizationController: () => ({ plugins: [], propertyConfigs: {}, entityActions: [], components: {}, resolvedSlots: [] }),
        usePermissions: () => ({ canCreate: () => true, canEdit: () => true, canDelete: () => true }),
        useScrollRestoration: () => undefined,
        useDataTableController: () => tableController,
        useSlot: () => []
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});
jest.mock("../../src/hooks/useAdminContext", () => ({ useAdminContext: () => ({}) }));
jest.mock("../../src/hooks/useSidePanel", () => ({ useSidePanel: () => ({ open: () => undefined }) }));
jest.mock("../../src/hooks/useChildViewSource", () => ({ useChildViewSource: () => undefined }));
jest.mock("../../src/hooks/useSelectionDialog", () => ({ useSelectionDialog: () => ({ open: () => undefined }) }));
jest.mock("../../src/hooks/navigation/contexts/CollectionRegistryContext", () => ({
    useCollectionRegistryController: () => ({ getCollection: () => undefined })
}));
jest.mock("../../src/hooks/navigation/contexts/UrlContext", () => ({
    useUrlController: () => ({
        buildUrlCollectionPath: (path: string) => `/c/${path}`,
        navigate: () => undefined
    })
}));

import { CollectionViewBinding } from "../../src/components/CollectionViewBinding/CollectionViewBinding";

// jsdom loads no Tailwind. The list finds what it scrolls with by computed
// style, so give the one utility that decides it the rule it has in the app —
// otherwise the scroller found is the document, not the collection's own.
const style = document.createElement("style");
style.textContent = ".overflow-y-auto { overflow-y: auto; }";
document.head.appendChild(style);

async function renderListView() {
    let container!: HTMLElement;
    await act(async () => {
        ({ container } = render(
            <MemoryRouter>
                <CollectionViewBinding slug={"products"}
                    name={"Products"}
                    path={"products"}
                    defaultViewMode={"list"}
                    openEntityMode={"full_screen"}
                    properties={{ name: { type: "string", name: "Name" } }}/>
            </MemoryRouter>
        ));
    });
    await waitFor(() => expect(container.textContent).toContain("Product 0"));
    const scroller = container.querySelector<HTMLElement>(".overflow-y-auto");
    if (!scroller) throw new Error("the list view rendered no scroller");
    return scroller;
}

describe("the list view, mounted again after a record opened full screen", () => {

    it("scrolls back to the offset the controller kept", async () => {
        const scroller = await renderListView();
        await waitFor(() => expect(scroller.scrollTop).toBe(640));
    });

    it("tells the controller where it is scrolled to", async () => {
        const scroller = await renderListView();
        onScroll.mockClear();

        scroller.scrollTop = 1200;
        fireEvent.scroll(scroller);

        expect(onScroll).toHaveBeenLastCalledWith(expect.objectContaining({ scrollOffset: 1200 }));
    });
});
