/**
 * @jest-environment jsdom
 */
import React from "react";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { AdminCollection, NavigationEntry, NavigationStateController } from "@rebasepro/cms-types";

/**
 * A blank scaffold (`rebase init --template blank`) serves one table, the
 * users table. After sign-up its CMS home was a lone "Settings / Users" card
 * with nothing saying how content gets there. The home page now says how to
 * add a table while the project declares none of its own.
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

const mockAdminMode: { mode: "content" | "studio" } = { mode: "content" };

// Every hook answers with the same object on every render, as the real
// providers do: the home page derives state from these in effects.
jest.mock("@rebasepro/app", () => {
    const translation = { t: (key: string) => key };
    const customization = { plugins: [], propertyConfigs: {}, entityActions: [], components: {}, resolvedSlots: [] };
    const adminMode = mockAdminMode;
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
// The cards read the whole Rebase context; what a card shows is not what this is about.
jest.mock("../../src/components/HomePage/NavigationCardBinding", () => ({
    NavigationCardBinding: ({ name }: { name: string }) => <div>{name}</div>
}));
jest.mock("../../src/hooks/useBreadcrumbsController", () => ({
    useBreadcrumbsController: () => ({ set: () => undefined })
}));
jest.mock("../../src/hooks/useAdminContext", () => ({
    useAdminContext: () => ({ navigationStateController: mockNavigationState.current })
}));

import { ContentHomePage } from "../../src/components/HomePage/ContentHomePage";

function collectionEntry(slug: string, { auth = false, group = "Views" }: { auth?: boolean, group?: string } = {}): NavigationEntry {
    const collection: AdminCollection = auth
        ? { slug, name: slug, properties: {}, auth: { enabled: true } }
        : { slug, name: slug, properties: {} };
    return { id: `collection:${slug}`, url: `/c/${slug}`, name: slug, slug, type: "collection", collection, group };
}

function navigation(entries: NavigationEntry[], loading = false): NavigationStateController {
    return {
        loading,
        refreshNavigation: () => undefined,
        topLevelNavigation: {
            allowDragAndDrop: false,
            navigationEntries: entries,
            groups: [...new Set(entries.map(e => e.group))],
            onNavigationEntriesUpdate: () => undefined
        }
    };
}

async function renderHome(nav: NavigationStateController) {
    mockNavigationState.current = nav;
    await act(async () => {
        render(<MemoryRouter><ContentHomePage/></MemoryRouter>);
    });
}

const usersOnly = [collectionEntry("users", { auth: true, group: "Settings" })];

describe("the CMS home of a project with no tables of its own", () => {

    afterEach(() => {
        cleanup();
        mockAdminMode.mode = "content";
    });

    it("says how to add a table, with a link to the docs", async () => {
        await renderHome(navigation(usersOnly));

        expect(screen.getByText("home_no_tables_title")).toBeTruthy();
        expect(screen.getByText(/export \{ notes \} from/)).toBeTruthy();
        const docs = screen.getByRole("link", { name: /home_no_tables_docs/ });
        expect(docs.getAttribute("href")).toBe("https://rebase.pro/docs/schema");
        // The users card is still there.
        expect(screen.getByText("users")).toBeTruthy();
    });

    it("is not shown once the project declares a table", async () => {
        await renderHome(navigation([...usersOnly, collectionEntry("posts")]));

        expect(screen.queryByText("home_no_tables_title")).toBeNull();
    });

    it("is not shown while the tables are still loading", async () => {
        await renderHome(navigation([], true));

        expect(screen.queryByText("home_no_tables_title")).toBeNull();
    });

    it("is not shown in Studio mode", async () => {
        mockAdminMode.mode = "studio";
        await renderHome(navigation(usersOnly));

        expect(screen.queryByText("home_no_tables_title")).toBeNull();
    });
});
