/**
 * @jest-environment jsdom
 *
 * A collection whose refresh fails after rows were shown says so with the kit's
 * error `Alert` in the reader's language: it was a hand-made red div that said
 * "Warning:" (or "Failed to update data.") in English whatever the locale.
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

if (typeof globalThis.ResizeObserver === "undefined") {
    class NoopResizeObserver {
        observe() { /* nothing to observe in jsdom */ }
        unobserve() { /* nothing to observe in jsdom */ }
        disconnect() { /* nothing to observe in jsdom */ }
    }
    Object.defineProperty(globalThis, "ResizeObserver", { value: NoopResizeObserver, configurable: true });
}

const rows = Array.from({ length: 3 }, (_, i) => ({ id: String(i), path: "products", values: { name: `Product ${i}` } }));

jest.mock("@rebasepro/app", () => {
    const tableController = {
        data: rows,
        dataLoading: false,
        noMoreToLoad: true,
        filterValues: undefined,
        setFilterValues: () => undefined,
        sortBy: undefined,
        setSortBy: () => undefined,
        searchString: undefined,
        setSearchString: () => undefined,
        clearFilter: () => undefined,
        itemCount: rows.length,
        setItemCount: () => undefined,
        paginationEnabled: false,
        pageSize: 50,
        checkFilterCombination: () => true,
        setPopupCell: () => undefined,
        dataLoadingError: new Error("connection reset by peer")
    };
    const overrides: Record<string, unknown> = {
        useTranslation: () => ({ t: (key: string) => key }),
        useData: () => ({ collection: () => ({ count: async () => rows.length, find: async () => ({ data: [] }) }) }),
        useAuthController: () => ({ user: { uid: "u1" } }),
        useRebaseContext: () => ({ authController: { user: { uid: "u1" } } }),
        useUserConfigurationPersistence: () => undefined,
        useAnalyticsController: () => ({}),
        useCustomizationController: () => ({ plugins: [], propertyConfigs: {}, entityActions: [], components: {}, resolvedSlots: [] }),
        usePermissions: () => ({ canCreate: () => true, canEdit: () => true, canDelete: () => true }),
        useScrollRestoration: () => undefined,
        useDataTableController: () => tableController,
        useSlot: () => []
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});
jest.mock("../../src/hooks/useAdminContext", () => ({ useAdminContext: () => ({}) }));
jest.mock("../../src/hooks/useSidePanel", () => ({ useSidePanel: () => ({ open: () => undefined }) }));
jest.mock("../../src/hooks/useChildViewSource", () => ({ useChildViewSource: () => undefined }));
jest.mock("../../src/hooks/useSelectionDialog", () => ({ useSelectionDialog: () => ({ open: () => undefined }) }));
jest.mock("../../src/hooks/navigation/contexts/CollectionRegistryContext", () => ({
    useCollectionRegistryController: () => ({ getCollection: () => undefined })
}));
jest.mock("../../src/hooks/navigation/contexts/UrlContext", () => ({
    useUrlController: () => ({
        buildUrlCollectionPath: (path: string) => `/c/${path}`,
        navigate: () => undefined
    })
}));

import { CollectionViewBinding } from "../../src/components/CollectionViewBinding/CollectionViewBinding";


describe("a failed refresh over rows already shown", () => {
    it("is an error alert with the translated lead and the cause", async () => {
        await act(async () => {
            render(
                <MemoryRouter>
                    <CollectionViewBinding slug={"products"}
                        name={"Products"}
                        path={"products"}
                        defaultViewMode={"list"}
                        openEntityMode={"full_screen"}
                        properties={{ name: { type: "string", name: "Name" } }}/>
                </MemoryRouter>
            );
        });
        const alert = await screen.findByRole("alert");
        expect(alert.textContent).toContain("error_loading_data");
        expect(alert.textContent).toContain("connection reset by peer");
        expect(alert.textContent).not.toContain("Warning:");
    });
});
