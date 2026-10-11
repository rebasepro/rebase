/**
 * @jest-environment jsdom
 *
 * A record in the list view opens from the keyboard, as a card does.
 *
 * The row was a `<div onClick>` with no role, tab stop or key handler, and the
 * list is the default view: Tab moved from checkbox to checkbox and Enter on a
 * row did nothing.
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Entity } from "@rebasepro/types";

if (typeof globalThis.ResizeObserver === "undefined") {
    class NoopResizeObserver { observe() { /* */ } unobserve() { /* */ } disconnect() { /* */ } }
    Object.defineProperty(globalThis, "ResizeObserver", { value: NoopResizeObserver, configurable: true });
}

jest.mock("@rebasepro/app", () => {
    const actual = jest.requireActual("@rebasepro/app") as Record<string, unknown>;
    const customization = { plugins: [], propertyConfigs: {}, locale: undefined, entityActions: [], resolvedSlots: [] };
    const translation = { t: (key: string) => key };
    const overrides: Record<string, unknown> = {
        useRebaseContext: () => ({}),
        useAuthController: () => ({ user: null }),
        useAnalyticsController: () => ({}),
        useCustomizationController: () => customization,
        useData: () => ({ collection: () => ({}) }),
        useTranslation: () => translation,
        useLargeLayout: () => true
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides) ? overrides[key] : actual[key as string]
    });
});
jest.mock("../../src/hooks/useAdminContext", () => ({ useAdminContext: () => ({}) }));

import { CollectionListViewBinding } from "../../src/components/CollectionViewBinding/CollectionListViewBinding";
import { useSelectionController } from "../../src/components/CollectionViewBinding/useSelectionController";

const collection = { slug: "products", name: "Products", properties: { name: { type: "string", name: "Name" } } };
const rows: Entity[] = [0, 1, 2].map((i) => ({ id: `id_${i}`, path: "products", values: { name: `Product ${i}` } }));

function List({ onEntityClick }: { onEntityClick: (entity: Entity) => void }) {
    const selectionController = useSelectionController();
    const tableController = React.useMemo(() => ({
        data: rows, dataLoading: false, noMoreToLoad: true, itemCount: rows.length,
        setItemCount: () => undefined, pageSize: 50, paginationEnabled: true
    }), []);
    return <CollectionListViewBinding collection={collection as never}
        tableController={tableController as never}
        selectionController={selectionController as never}
        onEntityClick={onEntityClick}
        selectionEnabled={true}
        path={"products"}
        highlightedEntities={[]}/>;
}

async function renderList() {
    const onEntityClick = jest.fn<(entity: Entity) => void>();
    await act(async () => {
        render(<List onEntityClick={onEntityClick}/>);
    });
    const row = (await screen.findByText("Product 1")).closest<HTMLElement>("[data-list-row]");
    if (!row) throw new Error("no list row around the record's title");
    return { row, onEntityClick };
}

describe("a list-view row from the keyboard", () => {

    it("is a focusable button", async () => {
        const { row } = await renderList();
        expect(row.getAttribute("role")).toBe("button");
        expect(row.tabIndex).toBe(0);
    });

    it("opens the record on Enter and on Space", async () => {
        const { row, onEntityClick } = await renderList();
        fireEvent.keyDown(row, { key: "Enter" });
        expect(onEntityClick).toHaveBeenCalledTimes(1);
        expect(onEntityClick.mock.calls[0][0].id).toBe("id_1");
        fireEvent.keyDown(row, { key: " " });
        expect(onEntityClick).toHaveBeenCalledTimes(2);
    });

    it("leaves Enter and Space on the row's own controls to them", async () => {
        const { row, onEntityClick } = await renderList();
        const checkbox = row.querySelector<HTMLElement>("button, [role=checkbox]");
        if (!checkbox) throw new Error("the row has no selection checkbox");
        fireEvent.keyDown(checkbox, { key: " " });
        fireEvent.keyDown(checkbox, { key: "Enter" });
        expect(onEntityClick).not.toHaveBeenCalled();
    });
});
