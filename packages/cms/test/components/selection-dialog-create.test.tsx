/**
 * @jest-environment jsdom
 */
import React from "react";
import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * The selection dialog's *Add* button, and the URL it must not take.
 *
 * `useUnsavedChangesDialog` blocks on a **pathname** change, and this panel's
 * path is a different collection from the one being edited. So opening it with
 * `updateUrl: true` made closing it a blocked navigation: `closeAfterSave`
 * clears the dirty flag and forces the close, but the blocker predicate is
 * registered in an effect, so the URL pop raced the re-render — and often
 * enough won, answering a successful save with "There are unsaved changes"
 * while the URL stayed on the target collection.
 *
 * Found on the sibling in `RelationSelector`; this call site had the same flag
 * and the same failure waiting behind it.
 */

let canCreateResult = true;
const sidePanelOpen = jest.fn();

// Every mocked hook returns the *same* object on every call. A fresh identity
// per render puts the controllers into effect dependency arrays that never
// settle, and the component re-renders until jest gives up — which is what a
// first draft of this file did.
jest.mock("../../src/hooks/useSidePanel", () => {
    const controller = { open: (...args: unknown[]) => sidePanelOpen(...args),
close: () => undefined,
replace: () => undefined };
    return { useSidePanel: () => controller };
});

jest.mock("../../src/hooks/navigation/contexts/UrlContext", () => {
    const controller = { resolveDatabasePathsFrom: (p: string) => p };
    return { useUrlController: () => controller };
});

jest.mock("../../src/components/SideDialogs", () => {
    const context = { close: () => undefined,
setBlocked: () => undefined };
    return { useSideDialogContext: () => context };
});

jest.mock("../../src/components/CollectionViewBinding/useSelectionController", () => {
    const controller = { selectedEntities: [],
setSelectedEntities: () => undefined,
toggleEntitySelection: () => undefined };
    return { useSelectionController: () => controller };
});

// The table itself is not what is under test — but it is what renders the
// `actions` slot the Add button lives in, so the mock renders that and nothing
// else.
jest.mock("../../src/components/CollectionTableBinding", () => ({
    CollectionTableBinding: ({ actions }: { actions?: React.ReactNode }) => <div>{actions}</div>,
    CollectionRowActions: () => null
}));

jest.mock("@rebasepro/app", () => {
    const auth = {};
    const customization = {};
    const analytics = { onAnalyticsEvent: () => undefined };
    const data = { collection: () => ({}) };
    const tableController = {};
    const columnIds: string[] = [];
    const permissions = { canCreate: () => canCreateResult };
    const translation = {
        t: (key: string, options?: { name?: string }) => options?.name ? `${key}:${options.name}` : key
    };
    return {
        CollectionScopeProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
        ErrorView: ({ error }: { error: string }) => <div>{error}</div>,
        IconForView: () => null,
        useAuthController: () => auth,
        useCustomizationController: () => customization,
        useAnalyticsController: () => analytics,
        useData: () => data,
        useDataTableController: () => tableController,
        useColumnIds: () => columnIds,
        useLargeLayout: () => true,
        usePermissions: () => permissions,
        useTranslation: () => translation
    };
});

import { SelectionTableBinding } from "../../src/components/ReferenceTable/SelectionTableBinding";

beforeAll(() => {
    Object.assign(Element.prototype, { scrollIntoView: () => undefined });
});

const collection = {
    slug: "companies",
    name: "Companies",
    singularName: "Company",
    properties: { name: { type: "string",
name: "Name" } }
} as never;

describe("creating a row from the selection dialog", () => {

    beforeEach(() => {
        canCreateResult = true;
        sidePanelOpen.mockClear();
    });

    it("does not push a URL for the create panel", () => {
        render(<SelectionTableBinding collection={collection} path="companies"/>);
        fireEvent.click(screen.getByText("add_specific:Company"));

        expect(sidePanelOpen).toHaveBeenCalledTimes(1);
        const props = sidePanelOpen.mock.calls[0][0] as Record<string, unknown>;
        expect(props.updateUrl).toBe(false);
        expect(props.path).toBe("companies");
        expect(props.closeOnSave).toBe(true);
    });

    it("makes no offer when the user cannot insert into the target", () => {
        canCreateResult = false;
        render(<SelectionTableBinding collection={collection} path="companies"/>);
        expect(screen.queryByText("add_specific:Company")).toBeNull();
    });
});
