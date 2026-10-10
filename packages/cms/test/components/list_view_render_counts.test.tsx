/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render } from "@testing-library/react";
import type { Entity } from "@rebasepro/types";
import type { EntityAction } from "@rebasepro/cms-types";

/**
 * The list view's rows are memoised, and a render of the list that changes no
 * row has to draw none. Each row was handed a new `listViewActions` array per
 * render — `filter` returns one even when nothing passes — and a selection
 * handler that changed with every tick, so every visible row was drawn again
 * on every emit, push and tick. Rows are counted by their one call to
 * `useEntitySlots`.
 */

if (typeof globalThis.ResizeObserver === "undefined") {
    class NoopResizeObserver { observe() { /* */ } unobserve() { /* */ } disconnect() { /* */ } }
    Object.defineProperty(globalThis, "ResizeObserver", { value: NoopResizeObserver, configurable: true });
}

const mockCounts = { rowRenders: 0, renderedIds: [] as string[] };

jest.mock("@rebasepro/app", () => {
    const actual = jest.requireActual("@rebasepro/app") as Record<string, unknown>;
    const auth = { user: null };
    const analytics = {};
    const customization = { plugins: [], propertyConfigs: {}, locale: undefined, entityActions: [], resolvedSlots: [] };
    const data = { collection: () => ({}) };
    const translation = { t: (key: string) => key };
    const overrides: Record<string, unknown> = {
        useRebaseContext: () => ({}),
        useAuthController: () => auth,
        useAnalyticsController: () => analytics,
        useCustomizationController: () => customization,
        useData: () => data,
        useTranslation: () => translation,
        useLargeLayout: () => true
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides) ? overrides[key] : actual[key as string]
    });
});
const mockAdminContext = {};
jest.mock("../../src/hooks/useAdminContext", () => ({ useAdminContext: () => mockAdminContext }));
jest.mock("../../src/components/CollectionViewBinding/usePreviewSlots", () => {
    const actual = jest.requireActual("../../src/components/CollectionViewBinding/usePreviewSlots") as Record<string, unknown>;
    const useEntitySlots = actual.useEntitySlots as (...args: unknown[]) => unknown;
    return {
        ...actual,
        useEntitySlots: (...args: unknown[]) => {
            mockCounts.rowRenders++;
            mockCounts.renderedIds.push(String((args[0] as Entity).id));
            return useEntitySlots(...args);
        }
    };
});

import { CollectionListViewBinding } from "../../src/components/CollectionViewBinding/CollectionListViewBinding";
import { useSelectionController } from "../../src/components/CollectionViewBinding/useSelectionController";

const collection = {
    slug: "products",
    name: "Products",
    properties: {
        name: { type: "string", name: "Name" },
        status: { type: "string", name: "Status", enum: [{ id: "a", label: "A" }, { id: "b", label: "B" }] }
    }
};

const row = (i: number): Entity => ({
    id: `id_${i}`,
    path: "products",
    values: { name: `Product ${i}`, status: i % 2 ? "a" : "b" }
});

// What the collection view hands the list: actions, none of them shown in it.
const editOnly: EntityAction = { key: "edit", name: "Edit", onClick: () => undefined };
const getActionsForEntity = () => [editOnly];

function List({ data, tick }: { data: Entity[]; tick: number }) {
    const selectionController = useSelectionController();
    const tableController = React.useMemo(() => ({
        data,
        dataLoading: false,
        noMoreToLoad: true,
        itemCount: data.length,
        setItemCount: () => undefined,
        pageSize: 50,
        paginationEnabled: true
    }), [data]);
    return <div data-tick={tick}>
        <CollectionListViewBinding collection={collection as never}
            tableController={tableController as never}
            selectionController={selectionController as never}
            getActionsForEntity={getActionsForEntity as never}
            path={"products"}
            highlightedEntities={[]}/>
    </div>;
}

function reset() {
    mockCounts.rowRenders = 0;
    mockCounts.renderedIds = [];
}

describe("the list view draws again only the rows that changed", () => {

    it("a render of the list that changes no row draws none", async () => {
        const rows = Array.from({ length: 100 }, (_, i) => row(i));
        let view!: ReturnType<typeof render>;
        await act(async () => {
            view = render(<List data={rows} tick={0}/>);
        });
        expect(mockCounts.rowRenders).toBeGreaterThan(5);

        reset();
        await act(async () => view.rerender(<List data={rows} tick={1}/>));
        await act(async () => view.rerender(<List data={rows.slice()} tick={2}/>));
        expect(mockCounts.rowRenders).toBe(0);
        view.unmount();
    });

    it("ticking a row draws that row", async () => {
        const rows = Array.from({ length: 100 }, (_, i) => row(i));
        let view!: ReturnType<typeof render>;
        await act(async () => {
            view = render(<List data={rows} tick={0}/>);
        });
        const checkboxes = () => Array.from(view.container.querySelectorAll<HTMLElement>("[role=\"checkbox\"]"))
            .filter(c => c.getAttribute("aria-label") !== "selection_select_all_loaded");

        reset();
        await act(async () => {
            fireEvent.click(checkboxes()[2]);
        });
        expect(checkboxes()[2].getAttribute("aria-checked")).toBe("true");
        // That row and no other (its display hooks may settle in a second pass).
        expect([...new Set(mockCounts.renderedIds)]).toEqual(["id_2"]);
        view.unmount();
    });
});
