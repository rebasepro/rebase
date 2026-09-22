/**
 * @jest-environment jsdom
 *
 * A record opened in a side panel carries the list's current URL state.
 *
 * The list writes its search, filters and sort with `history.replaceState`,
 * which react-router does not observe — its `location.search` keeps whatever
 * the view was mounted with. The panel URL was built from that stale value, so
 * opening a record from the board (or any view that opens records in a panel)
 * navigated to the mount-time query, and the list read it back as its state:
 * the search typed since mount, and any filter set since, were thrown away.
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type {
    AuthController,
    NavigationStateController,
    SideDialogPanelProps,
    SideDialogsController,
    UrlController
} from "@rebasepro/cms-types";
import type { CollectionRegistryController } from "@rebasepro/types";

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useLargeLayout: () => true,
        useCustomizationController: () => ({}),
        useComponentOverride: (_key: string, fallback: unknown) => fallback
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

import { useBuildSidePanel } from "../../src/hooks/useBuildSidePanel";

const opened: SideDialogPanelProps[] = [];

const sideDialogsController = {
    sidePanels: [],
    setSidePanels: () => undefined,
    close: () => undefined,
    open: (panel: SideDialogPanelProps | SideDialogPanelProps[]) => {
        opened.push(...(Array.isArray(panel) ? panel : [panel]));
    },
    replace: () => undefined
} satisfies SideDialogsController;

const urlController = {
    buildUrlCollectionPath: (p: string) => `/c/${p}`,
    resolveDatabasePathsFrom: (p: string) => p,
    isUrlCollectionPath: () => true,
    urlPathToDataPath: (p: string) => p
} as unknown as UrlController;

function renderSidePanel(routerSearch: string) {
    return renderHook(() => useBuildSidePanel(
        { collections: [] } as unknown as CollectionRegistryController,
        urlController,
        { loading: true } as unknown as NavigationStateController,
        sideDialogsController,
        { user: null } as unknown as AuthController
    ), {
        wrapper: ({ children }) => <MemoryRouter initialEntries={[`/c/products${routerSearch}`]}>{children}</MemoryRouter>
    });
}

describe("useBuildSidePanel — the URL of a record it opens", () => {

    beforeEach(() => {
        opened.length = 0;
    });

    it("carries the address bar's query, not the one react-router last saw", () => {
        // Mounted on "?search=ch"; the list has since written "chair" and a filter.
        window.history.replaceState(null, "", "/c/products?search=chair&status_op=%3D%3D&status_value=draft");
        const { result } = renderSidePanel("?search=ch");

        result.current.open({ path: "products", entityId: "5", collection: { slug: "products", name: "Products", properties: {} } });

        expect(opened).toHaveLength(1);
        expect(opened[0].urlPath).toBe("/c/products/5?search=chair&status_op=%3D%3D&status_value=draft#side");
    });

    it("carries it onto a new record too", () => {
        window.history.replaceState(null, "", "/c/products?search=chair");
        const { result } = renderSidePanel("");

        result.current.open({ path: "products", collection: { slug: "products", name: "Products", properties: {} } });

        expect(opened[0].urlPath).toBe("/c/products?search=chair#new_side");
    });
});
