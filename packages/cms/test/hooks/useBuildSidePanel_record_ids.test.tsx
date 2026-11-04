/**
 * @jest-environment jsdom
 *
 * A record whose id is not URL-safe opens in a side panel from its URL, and
 * the URL the panel writes for it leads back to it.
 *
 * The panel URL was built by handing the whole string, query and hash
 * included, to `buildUrlCollectionPath`, with the id written raw: the record
 * `a#b` got `/c/products/a#b#side`, whose hash is `#b#side`. And a reloaded
 * `/c/products/caf%C3%A9#side` opened the record `caf%C3%A9`.
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type {
    AdminCollection,
    AuthController,
    NavigationStateController,
    SideDialogPanelProps,
    SideDialogsController,
    SidePanelBindingProps,
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
import { useBuildUrlController } from "../../src/hooks/navigation/useBuildUrlController";

const variants = { slug: "variants", name: "Variants", properties: {} } as AdminCollection;
const products = { slug: "products", name: "Products", properties: {}, childCollections: () => [variants] } as AdminCollection;

const registry = {
    collections: [products]
} as Partial<CollectionRegistryController> as CollectionRegistryController;

const panels: SideDialogPanelProps[] = [];

const sideDialogsController = {
    sidePanels: [],
    setSidePanels: () => undefined,
    close: () => undefined,
    open: (panel: SideDialogPanelProps | SideDialogPanelProps[]) => {
        panels.push(...(Array.isArray(panel) ? panel : [panel]));
    },
    replace: (panel: SideDialogPanelProps | SideDialogPanelProps[]) => {
        panels.push(...(Array.isArray(panel) ? panel : [panel]));
    }
} satisfies SideDialogsController;

function renderSidePanel(url: string, loading: boolean) {
    return renderHook(() => {
        const urlController: UrlController = useBuildUrlController({
            basePath: "/",
            baseCollectionPath: "/c",
            collectionRegistryController: registry
        });
        return useBuildSidePanel(
            registry,
            urlController,
            { loading } as Partial<NavigationStateController> as NavigationStateController,
            sideDialogsController,
            { user: null } as Partial<AuthController> as AuthController
        );
    }, {
        wrapper: ({ children }) => <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
    });
}

function panelRecord(panel: SideDialogPanelProps): SidePanelBindingProps | undefined {
    return panel.additional as SidePanelBindingProps | undefined;
}

// Each id as the database holds it, and as the browser's pathname carries it.
const ids: [string, string, string][] = [
    ["a plain id", "B34SAP8Z", "B34SAP8Z"],
    ["a unicode id", "café", "caf%C3%A9"],
    ["an id with a space", "big chair", "big%20chair"],
    ["an id with #", "a#b", "a%23b"],
    ["an id with ?", "a?b", "a%3Fb"],
    ["an id with %", "50%", "50%25"]
];

describe("useBuildSidePanel — a record whose id is not URL-safe", () => {

    beforeEach(() => {
        panels.length = 0;
        window.history.replaceState(null, "", "/c/products?search=chair");
    });

    it.each(ids)("writes %s into the panel URL as one segment", (_label, id, encoded) => {
        const { result } = renderSidePanel("/c/products", true);

        result.current.open({ path: "products", entityId: id, selectedTab: "__json", collection: products });

        expect(panels).toHaveLength(1);
        expect(panels[0].urlPath).toBe(`/c/products/${encoded}/__json?search=chair#side`);
        expect(panels[0].parentUrlPath).toBe("/c/products");
    });

    it.each(ids)("writes %s under its parent record in a subcollection panel URL", (_label, id, encoded) => {
        const { result } = renderSidePanel("/c/products", true);

        result.current.open({ path: `products/${id}/variants`, entityId: id, collection: variants });

        expect(panels[0].urlPath).toBe(`/c/products/${encoded}/variants/${encoded}?search=chair#side`);
        expect(panels[0].parentUrlPath).toBe(`/c/products/${encoded}/variants`);
    });

    // The panels the hook draws for the URL it was mounted on. This mock's
    // panel list never fills, so the URL-sync effect draws the same panel again.
    function expectPanelsFor(entityId: string, path: string, urlPath: string) {
        expect(panels.length).toBeGreaterThan(0);
        for (const panel of panels) {
            expect(panelRecord(panel)?.entityId).toBe(entityId);
            expect(panelRecord(panel)?.path).toBe(path);
            expect(panel.urlPath).toBe(urlPath);
        }
    }

    it.each(ids)("opens %s from a reloaded panel URL", (_label, id, encoded) => {
        renderSidePanel(`/c/products/${encoded}#side`, false);
        expectPanelsFor(id, "products", `/c/products/${encoded}?search=chair#side`);
    });

    it.each(ids)("opens a subcollection record under %s from a reloaded panel URL", (_label, id, encoded) => {
        renderSidePanel(`/c/products/${encoded}/variants/${encoded}#side`, false);
        expectPanelsFor(id, `products/${id}/variants`, `/c/products/${encoded}/variants/${encoded}?search=chair#side`);
    });

    it("still writes a new record's panel URL with the list's query", () => {
        const { result } = renderSidePanel("/c/products", true);

        result.current.open({ path: "products", collection: products });

        expect(panels[0].urlPath).toBe("/c/products?search=chair#new_side");
    });
});
