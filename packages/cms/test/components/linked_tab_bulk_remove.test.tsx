/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { Entity } from "@rebasepro/types";
import type { SelectionController } from "@rebasepro/cms-types";

/**
 * Removing rows from a junction-backed (linked) tab in bulk.
 *
 * The server only unlinks those rows from the parent; they stay in their own
 * collection. The row action already said so. The toolbar's bin opened the
 * same dialog without saying which kind of removal it was, so it fell back to
 * "Delete 3 Tags? This cannot be undone." for an operation that deletes
 * nothing.
 */

if (typeof globalThis.ResizeObserver === "undefined") {
    class NoopResizeObserver {
        observe() { /* nothing to observe in jsdom */ }
        unobserve() { /* nothing to observe in jsdom */ }
        disconnect() { /* nothing to observe in jsdom */ }
    }
    Object.defineProperty(globalThis, "ResizeObserver", { value: NoopResizeObserver, configurable: true });
}

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
        useData: () => ({ collection: () => ({ count: async () => 2, find: async () => ({ data: [] }) }) }),
        useAuthController: () => ({ user: { uid: "u1" } }),
        useUserConfigurationPersistence: () => undefined,
        useAnalyticsController: () => ({}),
        useCustomizationController: () => ({ plugins: [], propertyConfigs: {}, entityActions: [], components: {}, resolvedSlots: [] }),
        usePermissions: () => ({ canCreate: () => true, canEdit: () => true, canDelete: () => true }),
        useScrollRestoration: () => undefined,
        useDataTableController: () => tableController,
        useLargeLayout: () => true,
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
jest.mock("../../src/hooks/useChildViewSource", () => ({
    useChildViewSource: () => ({ kind: "relation", mode: "linked", targetSlug: "tags" })
}));
jest.mock("../../src/hooks/useSelectionDialog", () => ({ useSelectionDialog: () => ({ open: () => undefined }) }));
jest.mock("../../src/hooks/navigation/contexts/CollectionRegistryContext", () => ({
    useCollectionRegistryController: () => ({
        getCollection: () => undefined,
        getParentCollectionSlugs: () => ["posts"],
        getParentEntityIds: () => ["7"]
    })
}));
jest.mock("../../src/hooks/navigation/contexts/UrlContext", () => ({
    useUrlController: () => ({
        buildUrlCollectionPath: (path: string) => `/c/${path}`,
        navigate: () => undefined
    })
}));

import { CollectionViewBinding } from "../../src/components/CollectionViewBinding/CollectionViewBinding";

type Tag = { name: string };

const tags: Entity<Tag>[] = [
    { id: "1", path: "posts/7/tags", values: { name: "red" } },
    { id: "2", path: "posts/7/tags", values: { name: "blue" } }
];

const selectionController: SelectionController<Tag> = {
    selection: { type: "entities", entities: tags },
    setSelection: () => undefined,
    selectedCount: 2,
    hasSelection: true,
    setSelectedEntities: () => undefined,
    selectAllMatching: () => undefined,
    clearSelection: () => undefined,
    isEntitySelected: (entity) => tags.some(tag => tag.id === entity.id),
    toggleEntitySelection: () => undefined
};

describe("bulk removal from a linked tab", () => {

    it("says the rows are removed from this record, not deleted", async () => {
        await act(async () => {
            render(
                <MemoryRouter>
                    <CollectionViewBinding<Tag> slug={"tags"}
                        name={"Tags"}
                        singularName={"Tag"}
                        path={"posts/7/tags"}
                        isSubCollection={true}
                        selectionController={selectionController}
                        properties={{ name: { type: "string", name: "Name" } }}/>
                </MemoryRouter>
            );
        });

        await act(async () => fireEvent.click(screen.getByText("(2)")));

        expect(screen.queryAllByText("confirm_delete_selection", { exact: false })).toHaveLength(0);
        expect(screen.getByText("confirm_multiple_unlink", { exact: false })).toBeTruthy();
    });
});
