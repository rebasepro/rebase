/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { SidePanelBindingProps } from "@rebasepro/cms-types";

/**
 * The collection count after a record is created in the side panel.
 *
 * The toolbar count is one read, not a subscription, and the collection view
 * reads it again when it is told rows changed: after a delete, and after
 * linking existing rows. A record created in the side panel (or a dialog)
 * leaves the view mounted and told it nothing, so the list grew by one row and
 * the toolbar kept the old total — as did "select all matching", which offers
 * that total. Without realtime, the table did not show the new row either.
 */

// jsdom has no ResizeObserver; the table and toolbar observe their own size.
if (typeof globalThis.ResizeObserver === "undefined") {
    class NoopResizeObserver {
        observe() { /* nothing to observe in jsdom */ }
        unobserve() { /* nothing to observe in jsdom */ }
        disconnect() { /* nothing to observe in jsdom */ }
    }
    Object.defineProperty(globalThis, "ResizeObserver", { value: NoopResizeObserver, configurable: true });
}

const count = jest.fn<() => Promise<number>>();
const openPanel = jest.fn<(props: SidePanelBindingProps) => void>();

jest.mock("@rebasepro/app", () => {
    const tableController = {
        data: [],
        dataLoading: false,
        noMoreToLoad: true,
        filterValues: undefined,
        setFilterValues: () => undefined,
        sortBy: undefined,
        setSortBy: () => undefined,
        searchString: undefined,
        setSearchString: () => undefined,
        clearFilter: () => undefined,
        itemCount: 0,
        setItemCount: () => undefined,
        paginationEnabled: false,
        pageSize: 50,
        checkFilterCombination: () => true,
        setPopupCell: () => undefined,
        onScroll: () => undefined
    };
    const overrides: Record<string, unknown> = {
        useTranslation: () => ({ t: (key: string) => key }),
        useData: () => ({ collection: () => ({ count, find: async () => ({ data: [] }) }) }),
        useAuthController: () => ({ user: { uid: "u1" } }),
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
jest.mock("../../src/hooks/useSidePanel", () => ({ useSidePanel: () => ({ open: openPanel }) }));
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
import { copyEntityAction } from "../../src/components/common/default_entity_actions";

describe("the collection count, after a record is created in the side panel", () => {

    it("is read again once the panel saves", async () => {
        count.mockResolvedValue(3);
        await act(async () => {
            render(
                <MemoryRouter>
                    <CollectionViewBinding slug={"products"}
                        name={"Products"}
                        path={"products"}
                        openEntityMode={"side_panel"}
                        properties={{ name: { type: "string", name: "Name" } }}/>
                </MemoryRouter>
            );
        });
        await waitFor(() => expect(count).toHaveBeenCalledTimes(1));

        fireEvent.click(screen.getByRole("button", { name: "add_specific" }));
        expect(openPanel).toHaveBeenCalledTimes(1);
        const panel = openPanel.mock.calls[0][0];
        expect(panel.entityId).toBeUndefined();

        count.mockResolvedValue(4);
        act(() => panel.onUpdate?.({ entity: { id: "4", path: "products", values: { name: "New" } } }));
        await waitFor(() => expect(count).toHaveBeenCalledTimes(2));
    });

    it("is read again once a copy made from a row is saved", async () => {
        // A row's actions are handed `onCollectionChange`, the same signal the
        // row's delete sends; the copy is a new row too.
        const onCollectionChange = jest.fn();
        const open = jest.fn<(props: SidePanelBindingProps) => void>();
        const entity = { id: "1", path: "products", values: { name: "Chair" } };
        await copyEntityAction.onClick({
            view: "collection",
            entity,
            path: "products",
            context: { urlController: { buildUrlCollectionPath: (path: string) => `/c/${path}` } } as never,
            sidePanelController: { open } as never,
            onCollectionChange,
            openEntityMode: "side_panel"
        });
        expect(open).toHaveBeenCalledTimes(1);
        expect(open.mock.calls[0][0].copy).toBe(true);

        open.mock.calls[0][0].onUpdate?.({ entity: { ...entity, id: "2" } });
        expect(onCollectionChange).toHaveBeenCalledTimes(1);
    });
});
