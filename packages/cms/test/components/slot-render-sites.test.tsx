/**
 * @jest-environment jsdom
 */
/**
 * The five slots that used to render nowhere, rendering.
 *
 * `slot-render-sites.test.ts` in `@rebasepro/cms-types` proves each slot name
 * now appears at a call site, by scanning the source. That is what keeps
 * `UNRENDERED_SLOTS` honest, and it is all a scan can prove: a `useSlot` whose
 * result is computed and never placed in the tree passes it, and so does one
 * handed a `path` of `undefined` or a `property` from the wrong scope.
 *
 * This renders the three components and checks what arrives. The props are the
 * half most likely to be wrong and the half a plugin author notices first —
 * `entity.row.actions` is worth nothing without the row it is for.
 */
import React from "react";
import { describe, expect, test, jest, beforeEach } from "@jest/globals";
import { render, screen } from "@testing-library/react";

/** Props each slot was rendered with, keyed by slot name. */
const seen: Record<string, Record<string, unknown>[]> = {};

/**
 * A stand-in for `useSlot` with the real one's contract: it renders one marker
 * per slot and records the props. Mocking the whole of `@rebasepro/app` is the
 * convention in this directory — the alternative is standing up nine providers
 * to reach one `div`.
 */
function fakeUseSlot(slot: string, props: Record<string, unknown>): React.ReactNode[] {
    (seen[slot] ??= []).push(props);
    return [<span key={slot} data-testid={`slot:${slot}`}/>];
}

beforeEach(() => {
    for (const key of Object.keys(seen)) delete seen[key];
});

// ── The app bar: `global.search` and `shell.toolbar` ──────────────────────────

jest.mock("@rebasepro/app", () => ({
    useSlot: fakeUseSlot,
    useRebaseContext: () => ({ marker: "context" }),
    useAuthController: () => ({ user: { uid: "u1", displayName: "Ada" }, signOut: async () => undefined }),
    useLargeLayout: () => true,
    useModeController: () => ({ mode: "light", setMode: () => undefined }),
    useAdminModeController: () => ({ mode: "cms" }),
    useTranslation: () => ({ t: (k: string) => k }),
    RebaseLogo: () => <svg/>,
    LanguageToggle: () => <span/>,
    UserSettingsView: () => <span/>,
    getIcon: () => <svg/>,
    getEntityFromCache: () => undefined,
    getLocalChangesBackup: () => false
}));

jest.mock("../../src/hooks/navigation/contexts/UrlContext", () => ({
    useUrlController: () => ({ basePath: "/" })
}));
jest.mock("../../src/components/app/useApp", () => ({
    useApp: () => ({ hasDrawer: false, drawerOpen: false, logo: undefined })
}));
jest.mock("../../src/hooks/useBreadcrumbsController", () => ({
    useBreadcrumbsController: () => ({ breadcrumbs: [] })
}));
jest.mock("../../src/hooks/useAdminContext", () => ({
    useAdminContext: () => ({ marker: "admin-context", sidePanelController: undefined })
}));

import { MemoryRouter } from "react-router";
import { DefaultAppBar } from "../../src/components/DefaultAppBar";
import { CollectionRowActions } from "../../src/components/CollectionTableBinding/CollectionRowActions";

describe("the shell slots render in the app bar", () => {
    function renderAppBar() {
        return render(<MemoryRouter><DefaultAppBar title={"Admin"}/></MemoryRouter>);
    }

    test("`global.search` is in the tree", () => {
        renderAppBar();
        expect(screen.getByTestId("slot:global.search")).toBeTruthy();
    });

    test("`shell.toolbar` is in the tree", () => {
        renderAppBar();
        expect(screen.getByTestId("slot:shell.toolbar")).toBeTruthy();
    });

    test("both are handed the context, which is all their props declare", () => {
        renderAppBar();
        expect(seen["global.search"][0]).toEqual({ context: { marker: "context" } });
        expect(seen["shell.toolbar"][0]).toEqual({ context: { marker: "context" } });
    });

    test("the search sits before the spacer and the toolbar after the actions", () => {
        // The two slots take identical props, so *where* they render is the only
        // thing that distinguishes them. Order in the DOM is that difference.
        const { container } = renderAppBar();
        const nodes = Array.from(container.querySelectorAll("[data-testid^='slot:']"));
        expect(nodes.map(n => n.getAttribute("data-testid")))
            .toEqual(["slot:global.search", "slot:shell.toolbar"]);
    });
});

// ── The table row: `entity.row.actions` ──────────────────────────────────────

describe("`entity.row.actions` renders per row", () => {
    const entity = { id: 42, values: { title: "Hello" }, path: "posts" } as never;
    const collection = { slug: "posts", name: "Posts" } as never;

    function renderRow(props: Record<string, unknown> = {}) {
        return render(
            <CollectionRowActions
                entity={entity}
                collection={collection}
                path={"posts"}
                width={140}
                size={"m"}
                openEntityMode={"side_panel"}
                {...props}
            />
        );
    }

    test("is in the tree even when the collection declares no actions of its own", () => {
        // The overlay that holds the row's tools is only rendered when there is
        // something to put in it, and a slot contribution is something. Without
        // this the slot would work on collections with actions and silently not
        // on the rest.
        renderRow();
        expect(screen.getByTestId("slot:entity.row.actions")).toBeTruthy();
    });

    test("is handed the row it is for, and the row's address", () => {
        renderRow();
        expect(seen["entity.row.actions"][0]).toMatchObject({
            entity,
            entityId: 42,
            path: "posts",
            collection,
            context: { marker: "admin-context", sidePanelController: undefined }
        });
    });

    test("forwards a selection controller when the table has one, and undefined when not", () => {
        const selectionController = { toggleEntitySelection: () => undefined } as never;
        renderRow({ selectionController });
        expect(seen["entity.row.actions"][0].selectionController).toBe(selectionController);

        renderRow();
        expect(seen["entity.row.actions"][1].selectionController).toBeUndefined();
    });
});
