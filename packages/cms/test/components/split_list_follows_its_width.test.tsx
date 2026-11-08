/**
 * @jest-environment jsdom
 *
 * The collection's split is the kit's `SplitView`: the list and the record sit
 * side by side when the split itself is wide, and the record covers the list
 * when it is narrow — whatever the window's width. A divider drag is
 * remembered for the collection, and the list shortcuts still move the record.
 */
import React from "react";
import { describe, expect, it, jest, beforeEach, afterEach } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { EntityTableController } from "@rebasepro/cms-types";

const mockNavigate = jest.fn();
jest.mock("react-router", () => ({
    ...(jest.requireActual("react-router") as Record<string, unknown>),
    useNavigate: () => mockNavigate,
    useLocation: () => ({ pathname: "/c/products/5", search: "", hash: "", state: null, key: "k" })
}));

jest.mock("../../src/components/EditViewBinding", () => ({
    EditViewBinding: () => <p>record form</p>
}));
jest.mock("../../src/components/DetailViewBinding", () => ({
    DetailViewBinding: () => null
}));
jest.mock("../../src/hooks/navigation/contexts/UrlContext", () => ({
    useUrlController: () => ({ buildUrlCollectionPath: (p: string) => `/c/${p}` })
}));
jest.mock("../../src/hooks/navigation/contexts/CollectionRegistryContext", () => ({
    useCollectionRegistryController: () => ({
        getParentCollectionSlugs: () => [],
        getParentEntityIds: () => []
    })
}));

import { SplitListView } from "../../src/components/CollectionViewBinding/SplitListView";

const data = [{ id: "5", path: "products", values: {} }, { id: "6", path: "products", values: {} }];
const tableController = { data } as unknown as EntityTableController<Record<string, unknown>>;

let splitWidth = 1200;
const rect = (width: number): DOMRect => ({ x: 0, y: 0, top: 0, left: 0, bottom: 600, right: width, width, height: 600, toJSON: () => ({}) });

function renderSplit(onEntityClick?: (entity: unknown) => void) {
    return render(
        <SplitListView
            collection={{ slug: "products", name: "Products", properties: {} }}
            tableController={tableController}
            path="products"
            selectedEntityId="5"
            {...(onEntityClick && { onEntityClick })}>
            <ul aria-label="Products"/>
        </SplitListView>
    );
}

describe("SplitListView — on the kit's SplitView", () => {

    beforeEach(() => {
        mockNavigate.mockReset();
        localStorage.clear();
        jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => rect(splitWidth));
    });
    afterEach(() => jest.restoreAllMocks());

    it("puts the list beside the record when the split is wide", () => {
        splitWidth = 1200;
        renderSplit();
        expect(screen.getByText("record form")).toBeTruthy();
        expect(screen.getByRole("separator")).toBeTruthy();
        expect(screen.getByRole("list", { name: "Products" }).closest(".invisible")).toBeNull();
    });

    it("covers the list with the record when the split is narrow", () => {
        splitWidth = 500;
        renderSplit();
        expect(screen.getByText("record form")).toBeTruthy();
        expect(screen.queryByRole("separator")).toBeNull();
        // Hidden, not unmounted: the list keeps its scroll under the record.
        expect(screen.getByRole("list", { name: "Products" }).closest(".invisible")).not.toBeNull();
    });

    it("remembers a divider move for the collection", () => {
        splitWidth = 1200;
        renderSplit();
        act(() => {
            fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowRight" });
        });
        expect(Number(localStorage.getItem("rebase_split_list_panel_size_products"))).toBeGreaterThan(22);
    });

    it("moves to the next record on j", () => {
        splitWidth = 1200;
        const onEntityClick = jest.fn();
        renderSplit(onEntityClick);
        act(() => {
            document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true, cancelable: true }));
        });
        expect(onEntityClick).toHaveBeenCalledWith(data[1]);
    });
});
