/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";

/**
 * In kanban the board's columns each run their own window; the table
 * controller the collection view builds in every mode is read only for its
 * search and filters there. Its first page used to stay live anyway: one more
 * subscription per open board — a server re-read and count on every write to
 * the collection, and a re-render of the whole view per push — for rows
 * nothing drew. The board is told so: `enabled: false` outside the views that
 * render the table's rows.
 */

if (typeof globalThis.ResizeObserver === "undefined") {
    class NoopResizeObserver {
        observe() { /* nothing to observe in jsdom */ }
        unobserve() { /* nothing to observe in jsdom */ }
        disconnect() { /* nothing to observe in jsdom */ }
    }
    Object.defineProperty(globalThis, "ResizeObserver", { value: NoopResizeObserver, configurable: true });
}

const tableController = {
    data: [],
    dataLoading: false,
    noMoreToLoad: true,
    filterValues: undefined,
    setFilterValues: () => undefined,
    sortBy: undefined,
    setSortBy: () => undefined,
    searchString: undefined,
    setSearchString: () => undefined,
    clearFilter: () => undefined,
    itemCount: 0,
    setItemCount: () => undefined,
    paginationEnabled: false,
    pageSize: 50,
    checkFilterCombination: () => true,
    setPopupCell: () => undefined,
    onScroll: () => undefined
};
const useDataTableController = jest.fn((_props: { enabled?: boolean }) => tableController);

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useTranslation: () => ({ t: (key: string) => key }),
        useData: () => ({ collection: () => ({ count: async () => 0, find: async () => ({ data: [] }) }) }),
        useAuthController: () => ({ user: { uid: "u1" } }),
        useUserConfigurationPersistence: () => undefined,
        useAnalyticsController: () => ({}),
        useCustomizationController: () => ({ plugins: [], propertyConfigs: {}, entityActions: [], components: {}, resolvedSlots: [] }),
        usePermissions: () => ({ canCreate: () => true, canEdit: () => true, canDelete: () => true }),
        useScrollRestoration: () => undefined,
        useDataTableController,
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
// The board's own windows are its business; this pins only what the view asks
// of the table controller beside it.
jest.mock("../../src/components/CollectionViewBinding/CollectionBoardViewBinding", () => ({
    CollectionBoardViewBinding: () => <div data-testid={"board"}/>
}));

import { CollectionViewBinding } from "../../src/components/CollectionViewBinding/CollectionViewBinding";

async function open(defaultViewMode: "kanban" | "list") {
    useDataTableController.mockClear();
    let view!: ReturnType<typeof render>;
    await act(async () => {
        view = render(
            <MemoryRouter>
                <CollectionViewBinding slug={"tasks"}
                    name={"Tasks"}
                    path={"tasks"}
                    defaultViewMode={defaultViewMode}
                    kanban={{ columnProperty: "status" }}
                    properties={{
                        name: { type: "string", name: "Name" },
                        status: { type: "string", name: "Status", enum: [{ id: "todo", label: "To do" }, { id: "done", label: "Done" }] }
                    }}/>
            </MemoryRouter>
        );
    });
    const calls = useDataTableController.mock.calls;
    return { view, enabled: calls[calls.length - 1][0].enabled };
}

describe("the table controller beside a board", () => {
    it("reads nothing in kanban", async () => {
        const { view, enabled } = await open("kanban");
        expect(view.getByTestId("board")).toBeTruthy();
        expect(enabled).toBe(false);
    });

    it("reads in the views that draw its rows", async () => {
        expect((await open("list")).enabled).not.toBe(false);
    });
});
