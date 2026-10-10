/**
 * @jest-environment jsdom
 */
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { Entity } from "@rebasepro/types";

/**
 * The collection view shows what it is given now, not what it was given first.
 *
 * - A plugin's column-header action (`collection.header.action`) was handed the
 *   table controller and collection the view held when the header was last
 *   built — the controller of the first render, since nothing rebuilt it — so a
 *   header action showing the search, the filter or the sort showed the old one.
 * - The view's props comparator compared a hand-picked list of collection
 *   props. A collection passed as props (one not in the registry) that changed
 *   its name, its actions or its custom views was not re-rendered at all.
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
    tick: number;
    listeners: Set<() => void>;
    searchString: string | undefined;
    controller: Record<string, unknown> | undefined;
    rows: Entity<Record<string, unknown>>[];
} = { tick: 0, listeners: new Set(), searchString: undefined, controller: undefined, rows: [] };

/** The table controller's state changes, as a search typed in the toolbar does. */
function mockSetSearch(searchString: string) {
    mockState.searchString = searchString;
    mockState.controller = undefined;
    mockState.tick++;
    mockState.listeners.forEach(l => l());
}

/** A plugin's column-header action that shows what it was handed. */
function HeaderProbe({ propertyKey, tableController, collection }: {
    propertyKey: string,
    tableController: { searchString?: string },
    collection: { name: string }
}) {
    if (propertyKey !== "name") return null;
    return <span data-testid={"header-probe"}>{`${tableController.searchString ?? "no search"} in ${collection.name}`}</span>;
}

// jsdom measures nothing: give the table a laptop-sized viewport.
jest.mock("react-use-measure", () => {
    const mod = jest.requireActual("react-use-measure") as { default?: (o?: unknown) => unknown };
    const actual = (typeof mod === "function" ? mod : mod.default) as (o?: unknown) => unknown;
    return (options?: { offsetSize?: boolean }) => {
        const real = actual(options) as [unknown, unknown];
        if (options?.offsetSize) return [real[0], { width: 1440, height: 900, top: 0, left: 0, bottom: 0, right: 0, x: 0, y: 0 }];
        return real;
    };
});

jest.mock("@rebasepro/app", () => {
    const ReactActual = jest.requireActual("react") as typeof React;
    const translation = { t: (key: string) => key };
    const data = { collection: () => ({ count: async () => 1, find: async () => ({ data: [] }) }) };
    const auth = { user: { uid: "u1" } };
    const rebaseContext = { authController: auth };
    const permissions = { canCreate: () => true, canEdit: () => true, canDelete: () => true };
    const analytics = {};
    const customization = {
        plugins: [],
        propertyConfigs: {},
        entityActions: [],
        components: {},
        resolvedSlots: [{ slot: "collection.header.action", Component: HeaderProbe }]
    };
    const noSlots: unknown[] = [];
    const subscribe = (listener: () => void) => {
        mockState.listeners.add(listener);
        return () => mockState.listeners.delete(listener);
    };
    const overrides: Record<string, unknown> = {
        useTranslation: () => translation,
        useData: () => data,
        useAuthController: () => auth,
        useRebaseContext: () => rebaseContext,
        useUserConfigurationPersistence: () => undefined,
        useAnalyticsController: () => analytics,
        useCustomizationController: () => customization,
        usePermissions: () => permissions,
        useScrollRestoration: () => undefined,
        useDataTableController: () => {
            ReactActual.useSyncExternalStore(subscribe, () => mockState.tick);
            if (!mockState.controller) {
                mockState.controller = {
                    data: mockState.rows,
                    dataLoading: false,
                    noMoreToLoad: true,
                    filterValues: undefined,
                    setFilterValues: () => undefined,
                    sortBy: undefined,
                    setSortBy: () => undefined,
                    searchString: mockState.searchString,
                    setSearchString: () => undefined,
                    clearFilter: () => undefined,
                    itemCount: mockState.rows.length,
                    setItemCount: () => undefined,
                    paginationEnabled: false,
                    pageSize: 50,
                    checkFilterCombination: () => true,
                    setPopupCell: () => undefined,
                    onScroll: () => undefined
                };
            }
            return mockState.controller;
        },
        useSlot: () => noSlots
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

const mockAdminContext = {};
const mockSidePanel = { open: () => undefined };
const mockSelectionDialog = { open: () => undefined };
// Not in the registry: the collection comes from the view's props.
const mockRegistry = {
    getCollection: () => undefined,
    getParentCollectionSlugs: () => [],
    getParentEntityIds: () => []
};
const mockUrlController = {
    buildUrlCollectionPath: (path: string) => `/c/${path}`,
    navigate: () => undefined
};
jest.mock("../../src/hooks/useAdminContext", () => ({ useAdminContext: () => mockAdminContext }));
jest.mock("../../src/hooks/useSidePanel", () => ({ useSidePanel: () => mockSidePanel }));
jest.mock("../../src/hooks/useChildViewSource", () => ({ useChildViewSource: () => undefined }));
jest.mock("../../src/hooks/useSelectionDialog", () => ({ useSelectionDialog: () => mockSelectionDialog }));
jest.mock("../../src/hooks/navigation/contexts/CollectionRegistryContext", () => ({
    useCollectionRegistryController: () => mockRegistry
}));
jest.mock("../../src/hooks/navigation/contexts/UrlContext", () => ({
    useUrlController: () => mockUrlController
}));

import { CollectionViewBinding } from "../../src/components/CollectionViewBinding/CollectionViewBinding";

const properties = { name: { type: "string", name: "Name" }, sku: { type: "string", name: "SKU" } };

function View({ name, viewMode = "table" }: { name: string, viewMode?: "table" | "list" }) {
    return <MemoryRouter>
        <CollectionViewBinding slug={"products"}
            name={name}
            path={"products"}
            defaultViewMode={viewMode}
            properties={properties as never}/>
    </MemoryRouter>;
}

beforeEach(() => {
    mockState.tick = 0;
    mockState.listeners.clear();
    mockState.searchString = undefined;
    mockState.controller = undefined;
    mockState.rows = [{ id: "p1", path: "products", values: { name: "Lamp", sku: "L-1" } }];
});

describe("a plugin's column-header action", () => {

    it("is handed the table controller the view holds now", async () => {
        await act(async () => {
            render(<View name={"Products"}/>);
        });
        expect(screen.getByTestId("header-probe").textContent).toBe("no search in Products");

        await act(async () => mockSetSearch("lamp"));

        expect(screen.getByTestId("header-probe").textContent).toBe("lamp in Products");
    });

    it("is handed the collection the view holds now", async () => {
        let view!: ReturnType<typeof render>;
        await act(async () => {
            view = render(<View name={"Products"}/>);
        });
        await act(async () => {
            view.rerender(<View name={"Catalogue"}/>);
        });
        expect(screen.getByTestId("header-probe").textContent).toBe("no search in Catalogue");
    });
});

describe("a collection passed as props", () => {

    it("shows its new name when the name changes", async () => {
        let view!: ReturnType<typeof render>;
        await act(async () => {
            view = render(<View name={"Products"} viewMode={"list"}/>);
        });
        expect(screen.getByRole("heading", { name: "Products" })).toBeTruthy();

        await act(async () => {
            view.rerender(<View name={"Catalogue"} viewMode={"list"}/>);
        });
        expect(screen.getByRole("heading", { name: "Catalogue" })).toBeTruthy();
    });
});
