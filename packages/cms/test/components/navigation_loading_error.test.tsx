/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { NavigationStateController } from "@rebasepro/cms-types";

/**
 * A failure while resolving the collections or views was caught, logged and
 * stored as `navigationLoadingError` — and read by nothing. A `collections`
 * builder that threw (or a plugin's `modifyCollections`, or the data either
 * awaited) left the home page an empty search bar, and a deep link to a
 * collection spinning for ever (or saying "Collection not found", which names
 * the wrong cause). Both now say what failed and offer a retry.
 */

if (typeof globalThis.ResizeObserver === "undefined") {
    class NoopResizeObserver {
        observe() { /* nothing to observe in jsdom */ }
        unobserve() { /* nothing to observe in jsdom */ }
        disconnect() { /* nothing to observe in jsdom */ }
    }
    Object.defineProperty(globalThis, "ResizeObserver", { value: NoopResizeObserver, configurable: true });
}

const mockNavigationState: { current: NavigationStateController } = {
    current: { loading: false, refreshNavigation: () => undefined }
};

// Every hook answers with the same object on every render, as the real
// providers do: the home page derives state from these in effects.
jest.mock("@rebasepro/app", () => {
    const translation = { t: (key: string) => key };
    const customization = { plugins: [], propertyConfigs: {}, entityActions: [], components: {}, resolvedSlots: [] };
    const adminMode = { mode: "content" };
    const registry = {};
    const scroll = { containerRef: { current: null }, direction: "up" };
    const collapsed = { isGroupCollapsed: () => false, toggleGroupCollapsed: () => undefined };
    const noSlots: unknown[] = [];
    const overrides: Record<string, unknown> = {
        useTranslation: () => translation,
        useUserConfigurationPersistence: () => undefined,
        useComponentOverride: (_name: string, Component: unknown) => Component,
        useNavigationBlocker: () => undefined,
        useCustomizationController: () => customization,
        useAdminModeController: () => adminMode,
        useRebaseRegistry: () => registry,
        useRestoreScroll: () => scroll,
        useCollapsedGroups: () => collapsed,
        useSlot: () => noSlots,
        SchemaDriftBanner: () => null
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});
jest.mock("../../src/hooks/navigation/contexts/CollectionRegistryContext", () => ({
    useCollectionRegistryController: () => ({
        collections: [],
        initialised: false,
        getCollection: () => undefined,
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
jest.mock("../../src/hooks/useBreadcrumbsController", () => ({
    useBreadcrumbsController: () => ({ set: () => undefined })
}));
jest.mock("../../src/hooks/useAdminContext", () => ({
    useAdminContext: () => ({ navigationStateController: mockNavigationState.current })
}));

import { RebaseRoute } from "../../src/routes/RebaseRoute";
import { ContentHomePage } from "../../src/components/HomePage/ContentHomePage";
import { NavigationStateContext } from "../../src/hooks/navigation/contexts/NavigationStateContext";

const emptyNavigation = { navigationEntries: [], groups: [] };

function failedNavigation(): NavigationStateController & { refreshNavigation: jest.Mock } {
    return {
        loading: false,
        topLevelNavigation: emptyNavigation,
        navigationLoadingError: new Error("collections builder failed: tenant lookup timed out"),
        refreshNavigation: jest.fn()
    };
}

describe("a navigation that failed to load", () => {

    it("a deep link to a collection says so and offers a retry", async () => {
        const navigation = failedNavigation();
        await act(async () => {
            render(
                <NavigationStateContext.Provider value={navigation}>
                    <MemoryRouter initialEntries={["/c/products"]}>
                        <RebaseRoute/>
                    </MemoryRouter>
                </NavigationStateContext.Provider>
            );
        });

        expect(screen.getByText("error_loading_navigation")).toBeTruthy();
        expect(screen.getByText(/tenant lookup timed out/)).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "retry" }));
        expect(navigation.refreshNavigation).toHaveBeenCalledTimes(1);
    });

    it("the home page says so instead of rendering empty", async () => {
        const navigation = failedNavigation();
        mockNavigationState.current = navigation;
        await act(async () => {
            render(<MemoryRouter><ContentHomePage/></MemoryRouter>);
        });

        expect(screen.getByText("error_loading_navigation")).toBeTruthy();
        expect(screen.getByText(/tenant lookup timed out/)).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "retry" }));
        expect(navigation.refreshNavigation).toHaveBeenCalledTimes(1);
    });
});
