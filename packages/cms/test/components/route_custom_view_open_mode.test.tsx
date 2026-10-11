/**
 * @jest-environment jsdom
 *
 * The router and the collection view decide how a record opens from the same
 * inputs, custom views included.
 *
 * A row click in a custom view that declares `openEntityMode: "full_screen"`
 * navigates to `/c/products/5?__view=price-map`. The router resolved the view
 * mode without the collection's custom views, so `price-map` read as unknown,
 * fell back to the list, resolved "split", and mounted the collection view with
 * the record selected; the collection view resolved "full_screen", ignored
 * the selection, and nothing opened.
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { AdminCollection, CollectionCustomView } from "@rebasepro/cms-types";

const priceMap: CollectionCustomView = { key: "price-map", name: "Price map", openEntityMode: "full_screen", Builder: () => null };
const registered: CollectionCustomView = { key: "calendar", name: "Calendar", openEntityMode: "full_screen", Builder: () => null };

const products = {
    slug: "products",
    name: "Products",
    properties: { name: { type: "string", name: "Name" } },
    customViews: [priceMap, "calendar"]
} as AdminCollection<Record<string, unknown>>;

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useUserConfigurationPersistence: () => undefined,
        useCustomizationController: () => ({ collectionViews: [registered] }),
        useComponentOverride: (_key: string, fallback: unknown) => fallback,
        useNavigationBlocker: () => ({ blocked: false }),
        useTranslation: () => ({ t: (key: string) => key })
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});
jest.mock("../../src/components/lazy_record_views", () => ({
    LazyCollectionViewBinding: (props: { selectedEntityId?: string | number }) =>
        <div data-testid="collection-view">{props.selectedEntityId !== undefined ? `selected ${props.selectedEntityId}` : "no selection"}</div>,
    LazyEditViewBinding: (props: { entityId?: string | number }) => <div data-testid="full-screen-record">{`record ${props.entityId}`}</div>,
    LazyDetailViewBinding: () => <div data-testid="detail-view"/>
}));
jest.mock("../../src/hooks/navigation/contexts/CollectionRegistryContext", () => ({
    useCollectionRegistryController: () => ({
        collections: [products],
        initialised: true,
        getCollection: (slug: string) => slug === "products" ? products : undefined,
        getParentCollectionSlugs: () => [],
        getParentEntityIds: () => []
    })
}));
jest.mock("../../src/hooks/navigation/contexts/UrlContext", () => ({
    useUrlController: () => ({
        urlPathToDataPath: (path: string) => path.replace(/^\/c\//, ""),
        buildUrlCollectionPath: (path: string) => `/c/${path}`,
        resolveDatabasePathsFrom: (path: string) => path,
        navigate: () => undefined
    })
}));
jest.mock("../../src/hooks/useBreadcrumbsController", () => ({ useBreadcrumbsController: () => ({ set: () => undefined }) }));
jest.mock("../../src/hooks/navigation/contexts/NavigationStateContext", () => ({
    useNavigationStateController: () => ({ navigationLoadingError: undefined, refreshNavigation: () => undefined })
}));

import { RebaseRoute } from "../../src/routes/RebaseRoute";

function renderAt(url: string) {
    render(<MemoryRouter initialEntries={[url]}><RebaseRoute/></MemoryRouter>);
}

describe("opening a record from a custom view", () => {

    it("opens it full screen when the inline custom view says so", async () => {
        renderAt("/c/products/5?__view=price-map");
        expect(await screen.findByTestId("full-screen-record")).toBeTruthy();
        expect(screen.queryByTestId("collection-view")).toBeNull();
    });

    it("opens it full screen when a view named from the app registry says so", async () => {
        renderAt("/c/products/5?__view=calendar");
        expect(await screen.findByTestId("full-screen-record")).toBeTruthy();
    });

    it("still opens a list's record beside the list", async () => {
        renderAt("/c/products/5?__view=list");
        expect((await screen.findByTestId("collection-view")).textContent).toBe("selected 5");
    });
});
