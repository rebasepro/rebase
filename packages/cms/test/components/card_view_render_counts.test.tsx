/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render } from "@testing-library/react";
import type { Entity } from "@rebasepro/types";

/**
 * The card grid used to draw every loaded card, and loading the next page drew
 * every one of them again — twice, once for "loading" and once for the rows —
 * so scrolling to N cards cost O(N²) card renders: 4,050 renders for the 50
 * cards of the 41st page. It draws the cards on screen now, and a page, a push
 * or a tick has to draw the cards that changed and no other.
 *
 * Counted with the real binding, grid and card: the `Collection.Card` override
 * slot hands back the real card wrapped in a counter.
 */

if (typeof globalThis.ResizeObserver === "undefined") {
    class NoopResizeObserver { observe() { /* */ } unobserve() { /* */ } disconnect() { /* */ } }
    Object.defineProperty(globalThis, "ResizeObserver", { value: NoopResizeObserver, configurable: true });
}

const mockCounts = { cardRenders: 0, renderedIds: [] as string[] };

jest.mock("@rebasepro/app", () => {
    const actual = jest.requireActual("@rebasepro/app") as Record<string, unknown>;
    const ReactActual = jest.requireActual("react") as typeof React;
    const auth = { user: null };
    const analytics = {};
    const customization = { plugins: [], propertyConfigs: {}, locale: undefined, entityActions: [], resolvedSlots: [] };
    const data = { collection: () => ({}) };
    const translation = { t: (key: string) => key };
    const wrapped = new Map<unknown, unknown>();
    const overrides: Record<string, unknown> = {
        useRebaseContext: () => ({}),
        useAuthController: () => auth,
        useAnalyticsController: () => analytics,
        useCustomizationController: () => customization,
        useData: () => data,
        useTranslation: () => translation,
        useLargeLayout: () => true,
        useComponentOverride: (_name: string, Default: React.ComponentType<Record<string, unknown>>) => {
            if (!wrapped.has(Default)) {
                wrapped.set(Default, function CountedCard(props: Record<string, unknown>) {
                    mockCounts.cardRenders++;
                    mockCounts.renderedIds.push(String((props.entity as Entity).id));
                    return ReactActual.createElement(Default, props);
                });
            }
            return wrapped.get(Default);
        }
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides) ? overrides[key] : actual[key as string]
    });
});

import { CollectionCardViewBinding } from "../../src/components/CollectionViewBinding/CollectionCardViewBinding";
import { useSelectionController } from "../../src/components/CollectionViewBinding/useSelectionController";

const collection = {
    slug: "products",
    name: "Products",
    properties: {
        name: { type: "string", name: "Name" },
        description: { type: "string", name: "Description", multiline: true },
        status: { type: "string", name: "Status", enum: [{ id: "a", label: "A" }, { id: "b", label: "B" }] },
        price: { type: "number", name: "Price" }
    }
};

const row = (i: number): Entity => ({
    id: `id_${i}`,
    path: "products",
    values: { name: `Product ${i}`, description: `A product called ${i}`, status: i % 2 ? "a" : "b", price: i }
});

function Grid({ data, loading, onEntityClick }: { data: Entity[]; loading: boolean; onEntityClick?: (e: Entity) => void }) {
    const selectionController = useSelectionController();
    const tableController = React.useMemo(() => ({
        data,
        dataLoading: loading,
        noMoreToLoad: false,
        itemCount: data.length,
        setItemCount: () => undefined,
        pageSize: 50,
        paginationEnabled: true
    }), [data, loading]);
    return <CollectionCardViewBinding collection={collection as never}
        tableController={tableController as never}
        selectionController={selectionController as never}
        onEntityClick={onEntityClick}
        highlightedEntities={[]}/>;
}

function resetCounts() {
    mockCounts.cardRenders = 0;
    mockCounts.renderedIds = [];
}

describe("the card grid draws again only the cards that changed", () => {

    // The grid draws the rows of cards on screen and a couple either side:
    // 2,000 loaded cards used to mean 2,000 cards mounted, ~44,000 DOM nodes.
    it("draws the cards on screen, not every card loaded", async () => {
        const rows = Array.from({ length: 2000 }, (_, i) => row(i));
        let view!: ReturnType<typeof render>;
        await act(async () => {
            view = render(<Grid data={rows} loading={false}/>);
        });
        expect(mockCounts.cardRenders).toBeLessThanOrEqual(60);
        expect(view.container.querySelectorAll("*").length).toBeLessThan(5_000);
        view.unmount();
    });

    it("loading the next page draws no card already drawn", async () => {
        const rows = Array.from({ length: 2000 }, (_, i) => row(i));
        let view!: ReturnType<typeof render>;
        await act(async () => {
            view = render(<Grid data={rows} loading={false}/>);
        });

        resetCounts();
        // The window emits "loading", then the rows with the next page — below
        // the screen, so nothing is drawn for them yet.
        await act(async () => view.rerender(<Grid data={rows} loading={true}/>));
        const more = rows.concat(Array.from({ length: 50 }, (_, i) => row(2000 + i)));
        await act(async () => view.rerender(<Grid data={more} loading={false}/>));

        expect(mockCounts.cardRenders).toBe(0);
        view.unmount();
    });

    it("a push that rebuilds equal rows draws nothing, and an edited row draws its card", async () => {
        const rows = Array.from({ length: 200 }, (_, i) => row(i));
        let view!: ReturnType<typeof render>;
        await act(async () => {
            view = render(<Grid data={rows} loading={false}/>);
        });

        resetCounts();
        const pushed = rows.map(r => ({ ...r, values: { ...r.values } }));
        await act(async () => view.rerender(<Grid data={pushed} loading={false}/>));
        expect(mockCounts.cardRenders).toBe(0);

        const edited = pushed.slice();
        edited[7] = { ...pushed[7], values: { ...pushed[7].values, name: "Renamed" } };
        await act(async () => view.rerender(<Grid data={edited} loading={false}/>));
        expect(mockCounts.renderedIds).toEqual(["id_7"]);
        expect(view.getByText("Renamed")).toBeTruthy();
        view.unmount();
    });

    it("ticking a card draws that card, and clicks still reach the view", async () => {
        const rows = Array.from({ length: 200 }, (_, i) => row(i));
        const clicked: string[] = [];
        let view!: ReturnType<typeof render>;
        await act(async () => {
            view = render(<Grid data={rows} loading={false} onEntityClick={(e) => clicked.push(String(e.id))}/>);
        });
        const checkboxes = () => Array.from(view.container.querySelectorAll<HTMLElement>("[role=\"checkbox\"]"));

        resetCounts();
        await act(async () => {
            fireEvent.click(checkboxes()[3]);
        });
        expect(checkboxes()[3].getAttribute("aria-checked")).toBe("true");
        expect(mockCounts.renderedIds).toEqual(["id_3"]);

        // A plain click opens the record; a modifier click ticks the card.
        await act(async () => {
            fireEvent.click(view.getByText("Product 5"));
        });
        expect(clicked).toEqual(["id_5"]);
        resetCounts();
        await act(async () => {
            fireEvent.click(view.getByText("Product 6"), { metaKey: true });
        });
        expect(clicked).toEqual(["id_5"]);
        expect(checkboxes()[6].getAttribute("aria-checked")).toBe("true");
        expect(mockCounts.renderedIds).toEqual(["id_6"]);
        view.unmount();
    });
});
