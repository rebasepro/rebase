/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach, afterEach } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { EntityCustomViewParams } from "@rebasepro/cms-types";

/**
 * A collection's `formView` Builder is the record's editor, not a picture of it.
 *
 * `FormViewConfig` documents that the Builder "receives the same props as
 * entity view tabs (entity, formContext, etc.)" and that `includeActions`
 * (default true) keeps Save beside it. The edit view rendered the Builder
 * *instead of* the form, so the only context it could hand over was the
 * read-only stand-in it keeps for tabs while the form mounts: `readOnly: true`,
 * and `setFieldValue` / `save` / `submit` — and `formex.setFieldValue` behind
 * them — all throwing. The real context only ever arrives through the form's
 * `onFormContextReady`, and there was no form. Save and Discard are gated on
 * that same context, so they never appeared either.
 *
 * In production every keystroke in a formView was dropped (the throw is
 * swallowed by the input's handler) and there was no button to save with.
 *
 * These tests render the real edit view down through the real form. A Builder
 * handed a writable fake passes against the bug — that is exactly how the app
 * that found it stayed green while it was dead.
 */

// The tab strip measures itself; jsdom has no ResizeObserver.
class ResizeObserverStub {
    observe() { /* no-op */ }
    unobserve() { /* no-op */ }
    disconnect() { /* no-op */ }
}
Object.assign(global, { ResizeObserver: ResizeObserverStub });

const ENTITY = {
    id: "m1",
    path: "mailboxes",
    values: { name: "Sales", signature: "" }
};

let canEdit = true;

/**
 * Handed to the barrel mock below and to the real context: `useSlot` and the
 * other hooks `@rebasepro/app` calls from inside itself do not go through the
 * mocked barrel.
 */
const customization = {
    plugins: [],
    propertyConfigs: {},
    entityActions: [],
    entityViews: [],
    resolvedSlots: []
};

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useFetch: ({ entityId }: { entityId?: string }) =>
            ({ entity: entityId ? ENTITY : undefined, dataLoading: false, dataLoadingError: undefined }),
        usePermissions: () => ({
            canEdit: () => canEdit,
            canCreate: () => false,
            canDelete: () => false
        }),
        useAuthController: () => ({ user: { uid: "u1" } }),
        useCustomizationController: () => customization,
        useData: () => ({ collection: () => ({ find: async () => ({ data: [] }) }) }),
        useSnackbarController: () => ({ open: () => undefined }),
        useAnalyticsController: () => ({}),
        useRebaseContext: () => ({})
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

jest.mock("../../src/hooks/useAdminContext", () => ({
    useAdminContext: () => ({ sidePanelController: {} })
}));

import { AuthControllerContext, CustomizationControllerContext, RebaseI18nProvider } from "@rebasepro/app";
import { EditViewBinding } from "../../src/components/EditViewBinding";
import { DetailViewBinding } from "../../src/components/DetailViewBinding";
import { UrlContext } from "../../src/hooks/navigation/contexts/UrlContext";
import { CollectionRegistryContext } from "../../src/hooks/navigation/contexts/CollectionRegistryContext";

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

const collectionRegistry = {
    getParentCollectionSlugs: () => [],
    getParentEntityIds: () => [],
    getCollection: () => undefined,
    collections: []
} as never;

/** Every set of props the Builder has rendered with, newest last. */
let received: EntityCustomViewParams[] = [];

function MailboxSettings(props: EntityCustomViewParams) {
    received.push(props);
    const { formContext } = props;
    return (
        <div data-testid={"mailbox-settings"}
            data-read-only={String(Boolean(formContext.readOnly))}
            data-disabled={String(formContext.disabled)}>
            <label>
                Signature
                <input
                    aria-label={"Signature"}
                    disabled={formContext.disabled}
                    value={String(formContext.values?.signature ?? "")}
                    onChange={(e) => formContext.setFieldValue("signature", e.target.value)}/>
            </label>
        </div>
    );
}

function collectionWith(admin: Record<string, unknown>) {
    return {
        name: "Mailboxes",
        singularName: "Mailbox",
        slug: "mailboxes",
        properties: {
            name: { type: "string", name: "Name" },
            signature: { type: "string", name: "Signature" }
        },
        ...admin
    } as never;
}

/** `entityId: undefined` opens the create form, as the "new" route does. */
function renderRecord(
    collection: never,
    { entityId, selectedTab }: { entityId?: string, selectedTab?: string } = { entityId: "m1" }
) {
    return render(
        <RebaseI18nProvider locale={"en"}>
            <AuthControllerContext.Provider value={{ user: { uid: "u1" } } as never}>
            <CustomizationControllerContext.Provider value={customization as never}>
                <MemoryRouter>
                    <UrlContext.Provider value={urlController}>
                        <CollectionRegistryContext.Provider value={collectionRegistry}>
                            <EditViewBinding
                                path="mailboxes"
                                collection={collection}
                                entityId={entityId}
                                selectedTab={selectedTab}
                                parentCollectionSlugs={[]}
                                parentEntityIds={[]}
                            />
                        </CollectionRegistryContext.Provider>
                    </UrlContext.Provider>
                </MemoryRouter>
            </CustomizationControllerContext.Provider>
            </AuthControllerContext.Provider>
        </RebaseI18nProvider>
    );
}

/** The read-only detail view — `defaultEntityAction: "view"`'s first screen. */
function renderDetail(collection: never) {
    return render(
        <RebaseI18nProvider locale={"en"}>
            <AuthControllerContext.Provider value={{ user: { uid: "u1" } } as never}>
            <CustomizationControllerContext.Provider value={customization as never}>
                <MemoryRouter>
                    <UrlContext.Provider value={urlController}>
                        <CollectionRegistryContext.Provider value={collectionRegistry}>
                            <DetailViewBinding
                                path="mailboxes"
                                collection={collection}
                                entityId={"m1"}
                                parentCollectionSlugs={[]}
                                parentEntityIds={[]}
                            />
                        </CollectionRegistryContext.Provider>
                    </UrlContext.Provider>
                </MemoryRouter>
            </CustomizationControllerContext.Provider>
            </AuthControllerContext.Provider>
        </RebaseI18nProvider>
    );
}

const latest = () => received[received.length - 1];

/**
 * Elements the user can see. The edit view keeps a hidden form mounted beside
 * whichever view is showing — which is what the read-only case has to survive —
 * so "rendered" and "on screen" are different questions here.
 */
const onScreen = (elements: HTMLElement[]) => elements.filter(el => !el.closest(".hidden"));

/** Let the form's effects publish its context, and the view re-render on it. */
const settle = () => act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
});

beforeEach(() => {
    canEdit = true;
    received = [];
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe("a formView Builder on the edit screen", () => {

    it("is handed the live form context, not the read-only stand-in", async () => {
        renderRecord(collectionWith({ formView: { Builder: MailboxSettings } }));

        await waitFor(() => expect(received.length).toBeGreaterThan(0));
        const { formContext } = latest();

        expect(formContext.readOnly).toBeFalsy();
        expect(formContext.disabled).toBe(false);
        expect(() => act(() => {
            formContext.setFieldValue("signature", "— Sales");
        })).not.toThrow();
        // `formex` is what `setFieldValue` writes through; the stub's threw too.
        expect(() => act(() => {
            formContext.formex.setFieldValue("signature", "— Sales");
        })).not.toThrow();
    });

    it("keeps what the user types, and offers Save for it", async () => {
        renderRecord(collectionWith({ formView: { Builder: MailboxSettings } }));

        const input = await screen.findByLabelText("Signature") as HTMLInputElement;
        await act(async () => {
            fireEvent.change(input, { target: { value: "Best, Sales" } });
        });

        await waitFor(() => expect(input.value).toBe("Best, Sales"));
        expect(latest().formContext.values.signature).toBe("Best, Sales");
        expect(latest().modifiedValues?.signature).toBe("Best, Sales");

        const save = await screen.findByRole("button", { name: "Save" });
        // Enabled once there is an edit to store — Save is gated on `dirty`.
        await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
        // And Discard, which only shows while there is something to discard.
        expect(screen.getByRole("button", { name: "Discard" })).toBeTruthy();
    });

    it("gets the record and its parent path, like every other entity view", async () => {
        renderRecord(collectionWith({ formView: { Builder: MailboxSettings } }));

        await waitFor(() => expect(received.length).toBeGreaterThan(0));
        expect(latest().parentCollectionSlugs).toEqual([]);
        expect(latest().parentEntityIds).toEqual([]);
        expect(latest().entity?.id).toBe("m1");
    });

    it("renders for a record being created, and offers Create", async () => {
        // No id, so there was not even a stand-in to hand over: the Builder was
        // never rendered, and creating a record showed an empty pane.
        renderRecord(collectionWith({ formView: { Builder: MailboxSettings } }), { entityId: undefined });

        const input = await screen.findByLabelText("Signature") as HTMLInputElement;
        expect(latest().formContext.status).toBe("new");
        await act(async () => {
            fireEvent.change(input, { target: { value: "Best, Sales" } });
        });
        await waitFor(() => expect(input.value).toBe("Best, Sales"));
        expect(screen.getByRole("button", { name: "Create" })).toBeTruthy();
    });

    it("does not offer Save when the formView declares includeActions: false", async () => {
        renderRecord(collectionWith({ formView: { Builder: MailboxSettings, includeActions: false } }));

        const input = await screen.findByLabelText("Signature") as HTMLInputElement;
        // Still live: the Builder owns persistence, it has not been disarmed.
        expect(latest().formContext.readOnly).toBeFalsy();
        await act(async () => {
            fireEvent.change(input, { target: { value: "Best, Sales" } });
        });
        await waitFor(() => expect(input.value).toBe("Best, Sales"));

        expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
    });
});

describe("an entity view tab beside a formView", () => {

    it("gets the live context too, once the form has mounted", async () => {
        // Tabs are handed the stand-in only until the form publishes its own
        // context. With a formView there was no form, so "until" was forever:
        // every tab of such a collection was read-only for as long as the
        // record stayed open.
        const tabProps: EntityCustomViewParams[] = [];
        const Activity = (props: EntityCustomViewParams) => {
            tabProps.push(props);
            return <div>{"Activity"}</div>;
        };
        renderRecord(collectionWith({
            formView: { Builder: MailboxSettings },
            entityViews: [{ key: "activity", name: "Activity", Builder: Activity }]
        }), { entityId: "m1", selectedTab: "activity" });

        await waitFor(() => expect(tabProps.length).toBeGreaterThan(0));
        await waitFor(() => expect(tabProps[tabProps.length - 1].formContext.readOnly).toBeFalsy());
        expect(tabProps[tabProps.length - 1].formContext.disabled).toBe(false);
    });
});

describe("a record its reader cannot edit", () => {

    it("tells a formView Builder the screen is view-only, and offers no Save", async () => {
        canEdit = false;
        renderRecord(collectionWith({ formView: { Builder: MailboxSettings } }));

        await waitFor(() => expect(received.length).toBeGreaterThan(0));
        await settle();

        // `disabled` is the flag every control already honours; a stand-in
        // that threw on write while reporting `disabled: false` invited the
        // write it was about to refuse.
        for (const props of received) {
            expect(props.formContext.disabled).toBe(true);
        }
        expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    });

    it("keeps the formView on screen once the hidden form has mounted", async () => {
        // The form mounts, hidden, beside the read-only view, and publishes its
        // context. The read-only view used to be handed its own only while
        // there was no such context — so the moment there was, the formView
        // gave way to the default rendering.
        canEdit = false;
        renderRecord(collectionWith({ formView: { Builder: MailboxSettings } }));

        await waitFor(() => expect(received.some(p => !p.formContext.readOnly)).toBe(true));
        await settle();

        const shown = onScreen(screen.getAllByTestId("mailbox-settings"));
        expect(shown).toHaveLength(1);
        expect(shown[0].dataset.readOnly).toBe("true");
        expect(shown[0].dataset.disabled).toBe("true");
    });

    it("keeps its additional fields once the hidden form has mounted", async () => {
        // The same mechanism without a formView: the read-only rendering leaves
        // `additionalFields` out when it has no context, and it lost its
        // context as soon as the hidden form published one.
        canEdit = false;
        renderRecord(collectionWith({
            additionalFields: [{
                key: "domain",
                name: "Domain",
                Builder: () => <span>{"sales.example.com"}</span>
            }]
        }));

        await waitFor(() => expect(screen.getAllByText("sales.example.com").length).toBeGreaterThan(0));
        await settle();

        expect(onScreen(screen.queryAllByText("sales.example.com"))).toHaveLength(1);
    });
});

describe("the read-only detail view", () => {

    it("tells a formView Builder it is view-only — the flag the edit screen never sets", async () => {
        // The other half of the distinction: a Builder decides between showing
        // and editing on `disabled`, so the two screens must disagree on it.
        renderDetail(collectionWith({ formView: { Builder: MailboxSettings } }));

        await waitFor(() => expect(received.length).toBeGreaterThan(0));
        expect(latest().formContext.disabled).toBe(true);
        expect(latest().formContext.readOnly).toBe(true);
        expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    });
});
