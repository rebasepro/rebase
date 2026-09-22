/**
 * @jest-environment jsdom
 *
 * Every way out of a split record lands back on the list the user built.
 *
 * The list mirrors its search, filters and sort into the address bar, and a
 * record is opened with all of them carried along (`navigateToEntity` →
 * `withListState`). The split's own navigations — the ✕, Escape, a tab change,
 * edit, save — built their URLs carrying the view mode and nothing else. The
 * list reads its state back from the URL on every navigation, so each of those
 * reset it: closing a record, or switching one of its tabs, emptied the search
 * box and dropped the filters and sort.
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { act, render } from "@testing-library/react";
import type { EntityTableController } from "@rebasepro/cms-types";

const mockNavigate = jest.fn();
jest.mock("react-router", () => ({
    ...(jest.requireActual("react-router") as Record<string, unknown>),
    useNavigate: () => mockNavigate,
    useLocation: () => ({ pathname: "/c/products/5", search: "", hash: "", state: null, key: "k" })
}));

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useLargeLayout: () => true
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

type PanelProps = {
    onCloseRequest?: () => void;
    onTabChange?: (params: { selectedTab?: string }) => void;
    onSaved?: () => void;
};
let panelProps: PanelProps = {};
jest.mock("../../src/components/EditViewBinding", () => ({
    EditViewBinding: (props: PanelProps) => {
        panelProps = props;
        return null;
    }
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

const LIST_STATE = "?__view=list&__sort=name&__sort_order=asc&status_op=%3D%3D&status_value=draft&search=chair";

const tableController = { data: [] } as unknown as EntityTableController<Record<string, unknown>>;

function renderSplit() {
    return render(
        <SplitListView
            collection={{ slug: "products", name: "Products", properties: {} }}
            tableController={tableController}
            path="products"
            selectedEntityId="5">
            <div/>
        </SplitListView>
    );
}

const lastNavigation = () => String(mockNavigate.mock.calls[mockNavigate.mock.calls.length - 1][0]);

const searchOf = (url: string) => new URLSearchParams(url.split("?")[1]?.split("#")[0] ?? "");

describe("SplitListView — navigations keep the list's state", () => {

    beforeEach(() => {
        mockNavigate.mockReset();
        panelProps = {};
        window.history.replaceState({}, "", `/c/products/5${LIST_STATE}`);
    });

    it("closing the record comes back to the same search, filter and sort", () => {
        renderSplit();
        act(() => panelProps.onCloseRequest?.());
        const url = lastNavigation();
        expect(url.split("?")[0]).toBe("/c/products");
        expect(searchOf(url).toString()).toEqual(searchOf(LIST_STATE).toString());
    });

    it("switching a tab of the record keeps them", () => {
        renderSplit();
        act(() => panelProps.onTabChange?.({ selectedTab: "history" }));
        const url = lastNavigation();
        expect(url.split("?")[0]).toBe("/c/products/5/history");
        expect(searchOf(url).get("search")).toBe("chair");
        expect(searchOf(url).get("status_value")).toBe("draft");
    });

    it("saving keeps them", () => {
        renderSplit();
        act(() => panelProps.onSaved?.());
        expect(searchOf(lastNavigation()).get("__sort")).toBe("name");
    });
});
