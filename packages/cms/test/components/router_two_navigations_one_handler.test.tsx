/**
 * @jest-environment jsdom
 *
 * What react-router actually does when one handler raises two navigations.
 *
 * This pins the arbiter, not a feature: several handlers in the admin
 * (`SidePanelBinding.onUpdate`, the `onSaved` chains) can reach two navigation
 * calls for a single user action, and which one survives decides whether a
 * panel closes. The rule today is **the last call wins** — the second
 * navigation interrupts the first, whatever mix of push, replace and `-1` they
 * are. Nothing in the app expresses that ordering, so if a react-router upgrade
 * flips it (to first-wins, or to dropping the interrupted one), these go red
 * and name the reason before the panels start misbehaving.
 *
 * See docs/bug-classes.md #28.
 */

import React from "react";
import { act, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useBlocker, useLocation, useNavigate } from "react-router";

// jsdom has no fetch primitives; the data router builds a Request per navigation.
if (typeof (globalThis as any).Request === "undefined") {
    (globalThis as any).Request = class {
        url: string;
        method: string;
        signal: unknown;
        constructor(url: string, init: { method?: string, signal?: unknown } = {}) {
            this.url = String(url);
            this.method = init.method ?? "GET";
            this.signal = init.signal;
        }
    };
}

type Navigate = ReturnType<typeof useNavigate>;

function Probe({ run }: { run: (navigate: Navigate) => void }) {
    const navigate = useNavigate();
    const location = useLocation();
    // The app keeps one blocker mounted for unsaved changes; it must not change
    // which navigation survives.
    useBlocker(React.useCallback(() => false, []));
    return <>
        <div data-testid="here">{location.pathname + location.hash}</div>
        <button data-testid="go" onClick={() => run(navigate)}>go</button>
    </>;
}

/**
 * `createBrowserRouter` is what the app boots (see RebaseRouter), so the probe
 * uses its in-memory twin rather than `MemoryRouter` — a data router navigates
 * asynchronously, which is the whole reason two calls can collide.
 */
function setup(run: (navigate: Navigate) => void) {
    const router = createMemoryRouter(
        [{ path: "*", element: <Probe run={run}/> }],
        { initialEntries: ["/list", "/list/1/edit"], initialIndex: 1 }
    );
    render(<RouterProvider router={router}/>);
    return () => screen.getByTestId("here").textContent;
}

async function click() {
    await act(async () => {
        screen.getByTestId("go").click();
    });
    await act(async () => {
        await new Promise(r => setTimeout(r, 20));
    });
}

describe("two navigate() calls in one handler", () => {

    it("replace then push — the push wins", async () => {
        const here = setup((navigate) => {
            navigate("/list/1", { replace: true });
            navigate("/list");
        });
        await click();
        expect(here()).toBe("/list");
    });

    it("push then push — the second wins", async () => {
        const here = setup((navigate) => {
            navigate("/list/1");
            navigate("/list");
        });
        await click();
        expect(here()).toBe("/list");
    });

    it("replace then back — the back wins", async () => {
        const here = setup((navigate) => {
            navigate("/list/1#side", { replace: true });
            navigate(-1);
        });
        await click();
        expect(here()).toBe("/list");
    });

    it("a replace to the current URL still loses to the push after it", async () => {
        const here = setup((navigate) => {
            navigate("/list/1/edit", { replace: true });
            navigate("/list");
        });
        await click();
        expect(here()).toBe("/list");
    });

    it("the same pair from an async continuation resolves the same way", async () => {
        const here = setup((navigate) => {
            void Promise.resolve().then(() => {
                navigate("/list/1", { replace: true });
                navigate("/list");
            });
        });
        await click();
        expect(here()).toBe("/list");
    });

    it("deferring the second call with setTimeout keeps it winning", async () => {
        const here = setup((navigate) => {
            navigate("/list/1", { replace: true });
            setTimeout(() => navigate("/list"), 0);
        });
        await click();
        expect(here()).toBe("/list");
    });
});
