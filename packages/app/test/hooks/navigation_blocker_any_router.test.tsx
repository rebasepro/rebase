/**
 * @jest-environment jsdom
 */
/**
 * The navigation blocker works under any React Router router.
 *
 * `NavigationBlockerProvider` called React Router's `useBlocker`, which exists
 * only under a *data* router (`createBrowserRouter` + `<RouterProvider>`). Under
 * a plain `<BrowserRouter>` — what most apps that drop one Rebase view into a
 * page of their own already have — it threw on the first render, and every
 * record form, side panel and split view went down with it.
 *
 * Without a data router, in-app navigations cannot be intercepted; leaving the
 * page still can. So a guard degrades to the browser's `beforeunload` prompt:
 * a reload or a tab close asks, exactly as it does under a data router.
 */
import React from "react";
import { act, render } from "@testing-library/react";
import { BrowserRouter, createMemoryRouter, RouterProvider, useNavigate } from "react-router";
import { NavigationBlockerProvider, useNavigationBlocker } from "@rebasepro/app";

let blocks = true;
const seen: { state?: string; navigate?: (to: string) => void } = {};

function Guarded() {
    seen.state = useNavigationBlocker(() => blocks).state;
    seen.navigate = useNavigate();
    return <span data-testid={"guarded"}/>;
}

function fireBeforeUnload(): boolean {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
}

beforeEach(() => {
    blocks = true;
    seen.state = undefined;
    seen.navigate = undefined;
});

describe("under a <BrowserRouter>", () => {
    it("renders instead of throwing", () => {
        const view = render(
            <BrowserRouter>
                <NavigationBlockerProvider>
                    <Guarded/>
                </NavigationBlockerProvider>
            </BrowserRouter>
        );
        expect(view.getByTestId("guarded")).toBeTruthy();
        expect(seen.state).toBe("unblocked");
        view.unmount();
    });

    it("guards leaving the page while a guard would block", () => {
        const view = render(
            <BrowserRouter>
                <NavigationBlockerProvider>
                    <Guarded/>
                </NavigationBlockerProvider>
            </BrowserRouter>
        );
        expect(fireBeforeUnload()).toBe(true);

        blocks = false;
        expect(fireBeforeUnload()).toBe(false);
        view.unmount();
    });

    it("stops guarding once the provider is gone", () => {
        const view = render(
            <BrowserRouter>
                <NavigationBlockerProvider>
                    <Guarded/>
                </NavigationBlockerProvider>
            </BrowserRouter>
        );
        view.unmount();
        expect(fireBeforeUnload()).toBe(false);
    });
});

describe("under a data router", () => {
    it("still blocks an in-app navigation", async () => {
        const router = createMemoryRouter([{
            path: "*",
            element: <NavigationBlockerProvider><Guarded/></NavigationBlockerProvider>
        }], { initialEntries: ["/a"] });
        const view = render(<RouterProvider router={router}/>);

        await act(async () => seen.navigate!("/b"));

        expect(seen.state).toBe("blocked");
        expect(router.state.location.pathname).toBe("/a");
        view.unmount();
    });
});
