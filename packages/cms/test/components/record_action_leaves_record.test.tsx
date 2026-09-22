/**
 * @jest-environment jsdom
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { AdminCollection, EntityAction } from "@rebasepro/cms-types";

/**
 * A record's own actions leave the record when they ask to.
 *
 * The delete action, once the row is gone, calls the `navigateBack` it was
 * handed. The record's overflow menu handed it the form's `navigateBack` —
 * which every layout wires to "leave the edit view for this record's detail
 * view". So deleting a record from its own menu left the split, the side panel
 * or the dialog open on a record that no longer existed ("Entity not found",
 * or with realtime off a stale, editable form). Only full screen was
 * special-cased in the action.
 */

const entity = { id: "7", path: "posts", values: { title: "Hello" } };

jest.mock("@rebasepro/app", () => {
    const context = {};
    const data = { collection: () => ({}) };
    const overrides: Record<string, unknown> = {
        useFetch: () => ({ entity, dataLoading: false, dataLoadingError: undefined }),
        usePermissions: () => ({ canEdit: () => true, canCreate: () => false, canDelete: () => false }),
        useAuthController: () => ({ user: { uid: "u1" } }),
        useRebaseContext: () => context,
        useData: () => data
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

// The form is not under test, and needs the whole admin to render.
jest.mock("../../src/form", () => ({ EntityFormBinding: () => null }));

// The identity bar renders the record's actions in an overflow menu; here the
// menu is simply open, so its items can be clicked.
jest.mock("../../src/components/EntityIdentityBar", () => {
    const { Menu } = jest.requireActual("@rebasepro/ui") as typeof import("@rebasepro/ui");
    return {
        EntityIdentityBar: ({ recordActions }: { recordActions?: React.ReactNode }) =>
            <Menu open={true} trigger={<button>more</button>}>{recordActions}</Menu>,
        EntitySaveActions: () => null
    };
});

const sideDialogClose = jest.fn();
jest.mock("../../src/components/SideDialogs", () => {
    const context = {
        close: (...args: unknown[]) => sideDialogClose(...args),
        setBlocked: () => undefined,
        setBlockedNavigationMessage: () => undefined,
        setPendingClose: () => undefined,
        pendingClose: false
    };
    return { useSideDialogContext: () => context };
});

import { AuthControllerContext, CustomizationControllerContext, RebaseI18nProvider } from "@rebasepro/app";
import { EditViewBinding } from "../../src/components/EditViewBinding";
import { UrlContext } from "../../src/hooks/navigation/contexts/UrlContext";

const archive: EntityAction = {
    key: "archive",
    name: "Archive",
    onClick: ({ navigateBack }) => navigateBack?.()
};

const collection = {
    name: "Posts",
    slug: "posts",
    properties: { title: { type: "string", name: "Title" } },
    entityActions: [archive]
} as unknown as AdminCollection;

const customization = { plugins: [], resolvedSlots: [], entityActions: [], propertyConfigs: {}, entityViews: [] } as never;

const urlController = {
    basePath: "/",
    baseCollectionPath: "/c",
    urlPathToDataPath: () => "",
    homeUrl: "/",
    isUrlCollectionPath: () => true,
    buildUrlCollectionPath: (p: string) => `/c/${p}`,
    buildAppUrlPath: () => "",
    resolveDatabasePathsFrom: () => "",
    navigate: () => undefined
} as never;

function renderRecord(layout: "split" | "side_panel", props: { onCloseRequest?: () => void, navigateBack?: () => void }) {
    return render(
        <RebaseI18nProvider locale="en">
            <AuthControllerContext.Provider value={{ user: { uid: "u1" } } as never}>
            <CustomizationControllerContext.Provider value={customization}>
                <MemoryRouter>
                    <UrlContext.Provider value={urlController}>
                        <EditViewBinding
                            path="posts"
                            collection={collection}
                            entityId="7"
                            layout={layout}
                            parentCollectionSlugs={[]}
                            parentEntityIds={[]}
                            {...props}/>
                    </UrlContext.Provider>
                </MemoryRouter>
            </CustomizationControllerContext.Provider>
            </AuthControllerContext.Provider>
        </RebaseI18nProvider>
    );
}

describe("a record action that navigates back", () => {

    beforeEach(() => {
        sideDialogClose.mockReset();
        jest.spyOn(console, "error").mockImplementation(() => undefined);
        jest.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("closes the split's record, rather than going to its detail view", () => {
        const onCloseRequest = jest.fn();
        const navigateBack = jest.fn();
        renderRecord("split", { onCloseRequest, navigateBack });

        fireEvent.click(screen.getByText("Archive"));

        expect(onCloseRequest).toHaveBeenCalledTimes(1);
        expect(navigateBack).not.toHaveBeenCalled();
    });

    it("closes the side panel, rather than replacing it with the detail view", () => {
        const navigateBack = jest.fn();
        renderRecord("side_panel", { navigateBack });

        fireEvent.click(screen.getByText("Archive"));

        expect(sideDialogClose).toHaveBeenCalledTimes(1);
        expect(sideDialogClose).toHaveBeenCalledWith(true);
        expect(navigateBack).not.toHaveBeenCalled();
    });
});
