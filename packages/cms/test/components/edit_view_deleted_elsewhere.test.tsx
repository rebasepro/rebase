/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

/**
 * Someone deletes a record while you have it open with edits of your own.
 *
 * The record's listener delivered `null`, the view took that for "this record
 * was never here" and swapped the whole form for "Entity not found" — with a
 * body blaming row-level security, the wrong cause. The edits were gone from
 * the screen, kept only in a local backup under a key no screen opens again.
 *
 * The form now stays, with what was typed in it, under a banner that says the
 * record was deleted elsewhere and offers to save the values as a new record.
 */

if (typeof globalThis.ResizeObserver === "undefined") {
    class NoopResizeObserver {
        observe() { /* nothing to observe in jsdom */ }
        unobserve() { /* nothing to observe in jsdom */ }
        disconnect() { /* nothing to observe in jsdom */ }
    }
    Object.defineProperty(globalThis, "ResizeObserver", { value: NoopResizeObserver, configurable: true });
}

/** What `useFetch` answers. Set per test. */
let fetched: { entity: unknown; dataLoading: boolean } = { entity: undefined, dataLoading: false };

/** The form, stubbed: what the view hands it is what is under test. */
function FormStub({ entity, children }: { entity?: { values: { title: string } }, children?: React.ReactNode }) {
    return <div>
        <input aria-label={"title"} defaultValue={entity?.values.title}/>
        {children}
    </div>;
}

jest.mock("@rebasepro/app", () => {
    const data = { collection: () => ({}) };
    const rebaseContext = {};
    const customization = { plugins: [], propertyConfigs: {}, entityActions: [], entityViews: [], components: {}, resolvedSlots: [] };
    const noSlots: unknown[] = [];
    const snackbar = { open: () => undefined, close: () => undefined };
    const analytics = {};
    const overrides: Record<string, unknown> = {
        useData: () => data,
        useRebaseContext: () => rebaseContext,
        useCustomizationController: () => customization,
        useSlot: () => noSlots,
        useSnackbarController: () => snackbar,
        useAnalyticsController: () => analytics,
        useFetch: () => ({ ...fetched, dataLoadingError: undefined }),
        usePermissions: () => ({ canEdit: () => true, canCreate: () => true, canDelete: () => true }),
        useAuthController: () => ({ user: { uid: "u1" } }),
        useComponentOverride: (name: string, Component: unknown) => name === "Entity.Form" ? FormStub : Component
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});
jest.mock("../../src/hooks/useAdminContext", () => ({ useAdminContext: () => ({ sidePanelController: { open: () => undefined } }) }));
jest.mock("../../src/components/SideDialogs", () => ({
    useSideDialogContext: () => ({ close: () => undefined, setBlocked: () => undefined })
}));

import { AuthControllerContext, RebaseI18nProvider } from "@rebasepro/app";
import { EditViewBinding } from "../../src/components/EditViewBinding";
import { UrlContext } from "../../src/hooks/navigation/contexts/UrlContext";

const collection = { name: "Posts", singularName: "Post", slug: "posts", properties: { title: { type: "string", name: "Title" } } } as never;

const urlController = {
    basePath: "/",
    baseCollectionPath: "/c",
    urlPathToDataPath: () => "",
    homeUrl: "/",
    isUrlCollectionPath: () => true,
    buildUrlCollectionPath: (p: string) => `/c/${p}`,
    buildAppUrlPath: () => "",
    resolveDatabasePathsFrom: () => "",
    navigate: (...args: unknown[]) => navigated.push(args)
} as never;

const navigated: unknown[][] = [];

function recordView() {
    return <RebaseI18nProvider locale={"en"}>
        <AuthControllerContext.Provider value={{ user: { uid: "u1" } } as never}>
            <MemoryRouter>
                <UrlContext.Provider value={urlController}>
                    <EditViewBinding
                        path="posts"
                        collection={collection}
                        entityId={"42"}
                        layout={"full_screen"}
                        parentCollectionSlugs={[]}
                        parentEntityIds={[]}
                    />
                </UrlContext.Provider>
            </MemoryRouter>
        </AuthControllerContext.Provider>
    </RebaseI18nProvider>;
}

beforeEach(() => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("a record deleted elsewhere while it is open", () => {

    it("keeps the form and says what happened", async () => {
        fetched = { entity: { id: "42", path: "posts", values: { title: "Draft title" } }, dataLoading: false };
        const view = render(recordView());
        expect((screen.getByLabelText("title") as HTMLInputElement).value).toBe("Draft title");

        fetched = { entity: undefined, dataLoading: false };
        await act(async () => view.rerender(recordView()));

        expect(screen.queryByText("Entity not found")).toBeNull();
        expect((screen.getByLabelText("title") as HTMLInputElement).value).toBe("Draft title");
        expect(screen.getByText(/deleted elsewhere/)).toBeTruthy();
        expect(screen.getByRole("button", { name: "Save as new" })).toBeTruthy();
    });

    it("saves what the form holds as a new record", async () => {
        fetched = { entity: { id: "42", path: "posts", values: { title: "Draft title" } }, dataLoading: false };
        const view = render(recordView());
        fetched = { entity: undefined, dataLoading: false };
        await act(async () => view.rerender(recordView()));
        navigated.length = 0;

        fireEvent.click(screen.getByRole("button", { name: "Save as new" }));

        expect(navigated).toEqual([["/c/posts#new", { replace: true, state: { defaultValues: { title: "Draft title" } } }]]);
    });

    it("still says a record that was never there is not found", () => {
        fetched = { entity: undefined, dataLoading: false };
        render(recordView());
        expect(screen.getByText("Entity not found")).toBeTruthy();
    });
});
