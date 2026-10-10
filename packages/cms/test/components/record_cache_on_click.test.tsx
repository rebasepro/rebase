/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { Entity } from "@rebasepro/types";

/**
 * A record opened from a list opens with the row's values on screen while its
 * own read catches up. That used to rest on the collection view writing every
 * row it held into the record cache on every update — 100,000 rows kept alive
 * after the view closed. The click puts the one row clicked there instead.
 */

if (typeof globalThis.ResizeObserver === "undefined") {
    class NoopResizeObserver {
        observe() { /* nothing to observe in jsdom */ }
        unobserve() { /* nothing to observe in jsdom */ }
        disconnect() { /* nothing to observe in jsdom */ }
    }
    Object.defineProperty(globalThis, "ResizeObserver", { value: NoopResizeObserver, configurable: true });
}

const rows: Entity[] = Array.from({ length: 3 }, (_, i) => ({ id: `t${i}`, path: "tasks", values: { name: `Task ${i}` } }));

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
    itemCount: 3,
    setItemCount: () => undefined,
    paginationEnabled: false,
    pageSize: 50,
    checkFilterCombination: () => true,
    setPopupCell: () => undefined,
    onScroll: () => undefined
};
const mockPopulate = jest.fn();

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useTranslation: () => ({ t: (key: string) => key }),
        useRebaseContext: () => ({}),
        useData: () => ({ collection: () => ({ count: async () => 3, find: async () => ({ data: [] }) }) }),
        useAuthController: () => ({ user: { uid: "u1" } }),
        useUserConfigurationPersistence: () => undefined,
        useAnalyticsController: () => ({}),
        useCustomizationController: () => ({ plugins: [], propertyConfigs: {}, entityActions: [], components: {}, resolvedSlots: [] }),
        usePermissions: () => ({ canCreate: () => true, canEdit: () => true, canDelete: () => true }),
        useScrollRestoration: () => undefined,
        useDataTableController: () => tableController,
        populateFetchCache: mockPopulate,
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
    useCollectionRegistryController: () => ({ getCollection: () => undefined, getParentCollectionSlugs: () => [], getParentEntityIds: () => [] })
}));
jest.mock("../../src/hooks/navigation/contexts/UrlContext", () => ({
    useUrlController: () => ({
        buildUrlCollectionPath: (path: string) => `/c/${path}`,
        navigate: () => undefined
    })
}));

import { CollectionViewBinding } from "../../src/components/CollectionViewBinding/CollectionViewBinding";

describe("opening a record from a list", () => {
    it("caches the row that was clicked, and only that one", async () => {
        let view!: ReturnType<typeof render>;
        await act(async () => {
            view = render(
                <MemoryRouter>
                    <CollectionViewBinding slug={"tasks"}
                        name={"Tasks"}
                        path={"tasks"}
                        defaultViewMode={"list"}
                        properties={{ name: { type: "string", name: "Name" } }}/>
                </MemoryRouter>
            );
        });
        expect(mockPopulate).not.toHaveBeenCalled();

        await act(async () => {
            fireEvent.click(view.getByText("Task 1"));
        });
        expect(mockPopulate).toHaveBeenCalledTimes(1);
        expect(mockPopulate).toHaveBeenCalledWith("tasks", [rows[1]]);
    });
});
