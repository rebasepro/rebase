/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

/**
 * What an empty collection says.
 *
 * "No results" was decided by "a filter, a sort or a search is set" — and
 * `sortBy` starts as the collection's declared `sort`. So an empty collection
 * with a default sort (the example app's customers has a two-key one) said "No
 * results with the applied filter/sort", with no filter on screen to clear, and
 * hid "Create your first entry". A sort cannot empty a set; only a search or a
 * filter the user can clear means "no results". A viewer who cannot create
 * now reads that the collection has no entries, not that a filter hid them.
 */

if (typeof globalThis.ResizeObserver === "undefined") {
    class NoopResizeObserver {
        observe() { /* nothing to observe in jsdom */ }
        unobserve() { /* nothing to observe in jsdom */ }
        disconnect() { /* nothing to observe in jsdom */ }
    }
    Object.defineProperty(globalThis, "ResizeObserver", { value: NoopResizeObserver, configurable: true });
}

const mockState: {
    filterValues: Record<string, unknown> | undefined;
    sortBy: [string, "asc" | "desc"][] | undefined;
    searchString: string | undefined;
    canCreate: boolean;
} = { filterValues: undefined, sortBy: undefined, searchString: undefined, canCreate: true };

jest.mock("@rebasepro/app", () => {
    const translation = { t: (key: string) => key };
    const data = { collection: () => ({ count: async () => 0, find: async () => ({ data: [] }) }) };
    const auth = { user: { uid: "u1" } };
    const analytics = {};
    const customization = { plugins: [], propertyConfigs: {}, entityActions: [], components: {}, resolvedSlots: [] };
    const noSlots: unknown[] = [];
    const overrides: Record<string, unknown> = {
        useTranslation: () => translation,
        useData: () => data,
        useAuthController: () => auth,
        useRebaseContext: () => ({ authController: auth }),
        useUserConfigurationPersistence: () => undefined,
        useAnalyticsController: () => analytics,
        useCustomizationController: () => customization,
        usePermissions: () => ({ canCreate: () => mockState.canCreate, canEdit: () => true, canDelete: () => true }),
        useScrollRestoration: () => undefined,
        useDataTableController: () => ({
            data: [],
            dataLoading: false,
            noMoreToLoad: true,
            filterValues: mockState.filterValues,
            setFilterValues: () => undefined,
            sortBy: mockState.sortBy,
            setSortBy: () => undefined,
            searchString: mockState.searchString,
            setSearchString: () => undefined,
            clearFilter: () => undefined,
            itemCount: 0,
            setItemCount: () => undefined,
            paginationEnabled: false,
            pageSize: 50,
            checkFilterCombination: () => true,
            setPopupCell: () => undefined,
            onScroll: () => undefined
        }),
        useSlot: () => noSlots
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
    useCollectionRegistryController: () => ({
        getCollection: () => undefined,
        getParentCollectionSlugs: () => [],
        getParentEntityIds: () => []
    })
}));
jest.mock("../../src/hooks/navigation/contexts/UrlContext", () => ({
    useUrlController: () => ({
        buildUrlCollectionPath: (path: string) => `/c/${path}`,
        navigate: () => undefined
    })
}));

import { CollectionViewBinding } from "../../src/components/CollectionViewBinding/CollectionViewBinding";

async function renderEmptyCollection(fixedFilter?: Record<string, unknown>) {
    await act(async () => {
        render(
            <MemoryRouter>
                <CollectionViewBinding slug={"customers"}
                    name={"Customers"}
                    path={"customers"}
                    sort={[["is_vip", "desc"], ["name", "asc"]]}
                    fixedFilter={fixedFilter as never}
                    properties={{ name: { type: "string", name: "Name" }, is_vip: { type: "boolean", name: "VIP" } }}/>
            </MemoryRouter>
        );
    });
}

describe("the empty state of an empty collection", () => {

    beforeEach(() => {
        mockState.filterValues = undefined;
        mockState.sortBy = [["is_vip", "desc"], ["name", "asc"]];
        mockState.searchString = undefined;
        mockState.canCreate = true;
    });

    it("offers to create the first entry under its declared default sort", async () => {
        await renderEmptyCollection();
        expect(screen.getByText("create_your_first_entry")).toBeTruthy();
        expect(screen.queryByText("no_results_filter_sort")).toBeNull();
    });

    it("offers it under the collection's fixed filter too: that is its scope, not a filter", async () => {
        mockState.filterValues = { status: ["==", "active"] };
        await renderEmptyCollection({ status: ["==", "active"] });
        expect(screen.getByText("create_your_first_entry")).toBeTruthy();
    });

    it("says no results when the user filtered", async () => {
        mockState.filterValues = { name: ["==", "bob"] };
        await renderEmptyCollection();
        expect(screen.getByText("no_results_filter")).toBeTruthy();
        expect(screen.queryByText("create_your_first_entry")).toBeNull();
    });

    it("says no results for a search", async () => {
        mockState.searchString = "bob";
        await renderEmptyCollection();
        expect(screen.getByText("no_results_search")).toBeTruthy();
    });

    it("tells a viewer who cannot create that there are no entries, not that a filter hid them", async () => {
        mockState.canCreate = false;
        await renderEmptyCollection();
        expect(screen.getByText("no_entries_found")).toBeTruthy();
        expect(screen.queryByText("no_results_filter_sort")).toBeNull();
    });
});
