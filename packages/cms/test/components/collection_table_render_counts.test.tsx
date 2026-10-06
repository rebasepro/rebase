/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { act, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { Entity } from "@rebasepro/types";

/**
 * What the collection table draws again, and when.
 *
 * The table holds a few hundred rows and draws ~20 of them, ~20 cells each.
 * A render of the collection view that changes nothing the table shows — a
 * window emit, the count arriving, a popover opening — has to draw nothing;
 * ticking one row's checkbox has to draw that row's actions and no property
 * cell. Counted with the real view, table and cells: the table's cell
 * renderer and each property cell ask `isDisabled` of their property once per
 * run, a property cell calls `useSelectableTableController` once per render,
 * and the row actions call `useSlot("entity.row.actions")` once per render.
 */

if (typeof globalThis.ResizeObserver === "undefined") {
    class NoopResizeObserver {
        observe() { /* nothing to observe in jsdom */ }
        unobserve() { /* nothing to observe in jsdom */ }
        disconnect() { /* nothing to observe in jsdom */ }
    }
    Object.defineProperty(globalThis, "ResizeObserver", { value: NoopResizeObserver, configurable: true });
}

const ROWS = 200;

const mockState: {
    rows: Entity<Record<string, unknown>>[];
    tick: number;
    listeners: Set<() => void>;
    controller: Record<string, unknown> | undefined;
    cellRendererRuns: number;
    propertyCellRenders: number;
    rowActionRenders: number;
} = { rows: [], tick: 0, listeners: new Set(), controller: undefined, cellRendererRuns: 0, propertyCellRenders: 0, rowActionRenders: 0 };

function mockResetCounts() {
    mockState.cellRendererRuns = 0;
    mockState.propertyCellRenders = 0;
    mockState.rowActionRenders = 0;
}

/** Re-render the collection view with every value it reads unchanged. */
function mockRerenderView() {
    mockState.tick++;
    mockState.listeners.forEach(l => l());
}

// jsdom measures nothing: give the table a laptop-sized viewport. Only the
// table's own call (it asks for `offsetSize`) is answered with fixed bounds.
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
    const data = { collection: () => ({ count: async () => ROWS, find: async () => ({ data: [] }) }) };
    const auth = { user: { uid: "u1" } };
    const rebaseContext = { authController: auth };
    const permissions = { canCreate: () => true, canEdit: () => true, canDelete: () => true };
    const analytics = {};
    const customization = { plugins: [], propertyConfigs: {}, entityActions: [], components: {}, resolvedSlots: [] };
    const noSlots: unknown[] = [];
    const subscribe = (listener: () => void) => {
        mockState.listeners.add(listener);
        return () => mockState.listeners.delete(listener);
    };
    const actualApp = jest.requireActual("@rebasepro/app") as { isDisabled: (p: unknown) => boolean };
    const overrides: Record<string, unknown> = {
        isDisabled: (property: unknown) => {
            mockState.cellRendererRuns++;
            return actualApp.isDisabled(property);
        },
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
                    noMoreToLoad: false,
                    filterValues: undefined,
                    setFilterValues: () => undefined,
                    sortBy: undefined,
                    setSortBy: () => undefined,
                    searchString: undefined,
                    setSearchString: () => undefined,
                    clearFilter: () => undefined,
                    itemCount: ROWS,
                    setItemCount: () => undefined,
                    paginationEnabled: true,
                    pageSize: 50,
                    checkFilterCombination: () => true,
                    setPopupCell: () => undefined,
                    onScroll: () => undefined
                };
            }
            return mockState.controller;
        },
        useSlot: (slot: string) => {
            if (slot === "entity.row.actions") mockState.rowActionRenders++;
            return noSlots;
        }
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});
jest.mock("../../src/components/SelectableTable/SelectableTableContext", () => {
    const actual = jest.requireActual("../../src/components/SelectableTable/SelectableTableContext") as Record<string, unknown>;
    const useActual = actual.useSelectableTableController as () => unknown;
    return {
        ...actual,
        useSelectableTableController: () => {
            mockState.propertyCellRenders++;
            return useActual();
        }
    };
});
// Every controller a context hands out is one object for the life of the app;
// a mock returning a new one per call would make every render look like a
// change.
const mockAdminContext = {};
const mockSidePanel = { open: () => undefined };
const mockSelectionDialog = { open: () => undefined };
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

const properties: Record<string, { type: "string"; name: string }> = {};
for (let p = 0; p < 12; p++) properties[`text_${p}`] = { type: "string", name: `Text ${p}` };

function buildRow(i: number): Entity<Record<string, unknown>> {
    const values: Record<string, unknown> = {};
    for (let p = 0; p < 12; p++) values[`text_${p}`] = `Row ${i} value ${p}`;
    return { id: `id_${i}`, path: "products", values };
}

function View({ selectionEnabled = true }: { selectionEnabled?: boolean }) {
    return <MemoryRouter>
        <CollectionViewBinding slug={"products"}
            name={"Products"}
            path={"products"}
            defaultViewMode={"table"}
            selectionEnabled={selectionEnabled}
            properties={properties as never}/>
    </MemoryRouter>;
}

function rowCheckboxes(container: HTMLElement) {
    return Array.from(container.querySelectorAll<HTMLElement>("#virtual-table [role=\"checkbox\"]"));
}

describe("the collection table draws again only what changed", () => {

    beforeEach(() => {
        mockState.rows = Array.from({ length: ROWS }, (_, i) => buildRow(i));
        mockState.controller = undefined;
        mockState.tick = 0;
        mockState.listeners.clear();
    });

    it("a render of the collection view that changes nothing in the table draws no cell", async () => {
        let view!: ReturnType<typeof render>;
        await act(async () => {
            view = render(<View/>);
        });
        // The table is up, with its rows' cells and actions.
        expect(mockState.propertyCellRenders).toBeGreaterThan(100);
        expect(mockState.rowActionRenders).toBeGreaterThan(10);

        mockResetCounts();
        await act(async () => mockRerenderView());
        await act(async () => mockRerenderView());

        expect(mockState.cellRendererRuns).toBe(0);
        expect(mockState.propertyCellRenders).toBe(0);
        expect(mockState.rowActionRenders).toBe(0);
        view.unmount();
    });

    it("ticking a row's checkbox draws the row actions and no property cell", async () => {
        let view!: ReturnType<typeof render>;
        await act(async () => {
            view = render(<View/>);
        });
        const drawnRows = view.container.querySelectorAll("#virtual-table [style*=\"position: absolute\"]").length;
        expect(drawnRows).toBeGreaterThan(10);

        const checkbox = rowCheckboxes(view.container)[2];
        expect(checkbox.getAttribute("aria-checked")).toBe("false");

        mockResetCounts();
        await act(async () => {
            fireEvent.click(checkbox);
        });

        // The row shows it.
        const ticked = rowCheckboxes(view.container)[2];
        expect(ticked.getAttribute("aria-checked")).toBe("true");
        expect(rowCheckboxes(view.container).filter(c => c.getAttribute("aria-checked") === "true")).toHaveLength(1);

        // Nothing a property cell shows depends on what is selected.
        expect(mockState.cellRendererRuns).toBe(0);
        expect(mockState.propertyCellRenders).toBe(0);
        // The row actions do: an action's `isEnabled` is asked with the
        // selection controller. At most once per row drawn.
        expect(mockState.rowActionRenders).toBeGreaterThan(0);
        expect(mockState.rowActionRenders).toBeLessThanOrEqual(drawnRows);
        view.unmount();
    });
});
