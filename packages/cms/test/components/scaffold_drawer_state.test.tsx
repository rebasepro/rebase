/**
 * @jest-environment jsdom
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";

// jsdom's matchMedia always reports false, which would send the real hook down
// the small-layout (modal sheet) branch most of this suite is not about.
//
// Modelled as a subscription rather than a bare variable because that is what the
// real hook is: `Scaffold` is memoised, so a breakpoint crossing only reaches it
// as a state update from inside the hook, never as a new prop.
let mockLargeLayout = true;
const mockLayoutSubscribers = new Set<(large: boolean) => void>();

jest.mock("@rebasepro/app", () => ({
    useLargeLayout: () => {
        const [large, setLarge] = React.useState(() => mockLargeLayout);
        React.useEffect(() => {
            mockLayoutSubscribers.add(setLarge);
            return () => {
                mockLayoutSubscribers.delete(setLarge);
            };
        }, []);
        return large;
    },
    useAdminModeController: () => ({ mode: "cms" }),
    useTranslation: () => ({ t: (k: string) => k })
}));

function setLargeLayout(large: boolean) {
    mockLargeLayout = large;
    act(() => {
        mockLayoutSubscribers.forEach(notify => notify(large));
    });
}

import { Scaffold } from "../../src/components/app/Scaffold";
import { useApp } from "../../src/components/app/useApp";
import { UrlContext } from "../../src/hooks/navigation/contexts/UrlContext";

const STORAGE_KEY = "rebase-drawer-open:/";

const DrawerStub: any = () => <div data-testid="drawer"/>;
DrawerStub.componentType = "Drawer";

function Probe() {
    const { drawerOpen, openDrawer, closeDrawer } = useApp();
    return (
        <div>
            <span data-testid="open-state">{String(drawerOpen)}</span>
            <button data-testid="expand" onClick={openDrawer}>expand</button>
            <button data-testid="collapse" onClick={closeDrawer}>collapse</button>
        </div>
    );
}

function renderScaffold(props: Record<string, unknown> = {}) {
    return render(
        <Scaffold {...props}>
            <DrawerStub/>
            <Probe/>
        </Scaffold>
    );
}

const drawerOpen = () => screen.getByTestId("open-state").textContent === "true";

describe("Scaffold drawer open state", () => {

    beforeEach(() => {
        window.localStorage.clear();
        mockLargeLayout = true;
    });

    test("starts collapsed when nothing has been stored", () => {
        renderScaffold();
        expect(drawerOpen()).toBe(false);
    });

    test("restores the stored expanded state across reloads", () => {
        window.localStorage.setItem(STORAGE_KEY, "true");
        renderScaffold();
        expect(drawerOpen()).toBe(true);
    });

    test("the stored choice beats defaultDrawerOpen", () => {
        window.localStorage.setItem(STORAGE_KEY, "false");
        renderScaffold({ defaultDrawerOpen: true });
        expect(drawerOpen()).toBe(false);
    });

    test("defaultDrawerOpen only seeds the first visit", () => {
        renderScaffold({ defaultDrawerOpen: true });
        expect(drawerOpen()).toBe(true);
    });

    test("toggling writes the choice to localStorage", () => {
        renderScaffold();

        fireEvent.click(screen.getByTestId("expand"));
        expect(drawerOpen()).toBe(true);
        expect(window.localStorage.getItem(STORAGE_KEY)).toBe("true");

        fireEvent.click(screen.getByTestId("collapse"));
        expect(drawerOpen()).toBe(false);
        expect(window.localStorage.getItem(STORAGE_KEY)).toBe("false");
    });

    test("hover does not expand the drawer when autoOpenDrawer is false", () => {
        const { container } = renderScaffold({ autoOpenDrawer: false });
        // The rail is the only element carrying the hover handlers.
        const rail = container.querySelector(".z-20") as HTMLElement;

        fireEvent.mouseEnter(rail);
        fireEvent.mouseMove(rail);

        expect(rail.style.width).toBe("72px");
        expect(rail.querySelector("div")?.style.width).toBe("72px");
    });

    test("hover expands the drawer by default", () => {
        const { container } = renderScaffold();
        const rail = container.querySelector(".z-20") as HTMLElement;

        fireEvent.mouseEnter(rail);
        fireEvent.mouseMove(rail);

        // The floating panel widens; the layout column stays a rail.
        expect(rail.style.width).toBe("72px");
        expect(rail.querySelector("div")?.style.width).toBe("280px");
    });

    test("hovering never persists anything", () => {
        const { container } = renderScaffold();
        fireEvent.mouseEnter(container.querySelector(".z-20") as HTMLElement);
        expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    test("narrowing past the breakpoint does not carry the expanded rail into the modal sheet", () => {
        window.localStorage.setItem(STORAGE_KEY, "true");
        renderScaffold();
        expect(drawerOpen()).toBe(true);

        setLargeLayout(false);

        expect(drawerOpen()).toBe(false);
        // The reset is a layout consequence, not a choice — it must not be stored.
        expect(window.localStorage.getItem(STORAGE_KEY)).toBe("true");
    });

    test("widening past the breakpoint restores the stored choice", () => {
        window.localStorage.setItem(STORAGE_KEY, "true");
        mockLargeLayout = false;
        renderScaffold();
        expect(drawerOpen()).toBe(false);

        setLargeLayout(true);

        expect(drawerOpen()).toBe(true);
    });

    test("two admins on one origin do not share a drawer", () => {
        window.localStorage.setItem("rebase-drawer-open:/admin", "true");

        render(
            <UrlContext.Provider value={{ basePath: "/admin" } as any}>
                <Scaffold><DrawerStub/><Probe/></Scaffold>
            </UrlContext.Provider>
        );

        expect(drawerOpen()).toBe(true);
        // The other admin's key is untouched, and did not seed this one.
        expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    describe("an open popover owes the drawer a collapse", () => {

        // Radix portals popover content outside the drawer, so reaching for it
        // fires a mouseleave. Collapsing then would pull the popover's own trigger
        // out from under the pointer.
        // React synthesises mouseenter/mouseleave from mouseover/mouseout, so the
        // pointer has to be moved the way the browser moves it.
        const enter = (rail: HTMLElement) => fireEvent.mouseMove(rail);
        const leave = (rail: HTMLElement) => fireEvent.mouseOut(rail, { relatedTarget: document.body });

        function openPopover() {
            const popper = document.createElement("div");
            popper.setAttribute("data-radix-popper-content-wrapper", "");
            document.body.appendChild(popper);
            return popper;
        }

        // Testing Library only cleans up its own container, and a popover left
        // behind reads to the next test as one that never closed.
        afterEach(() => {
            document.querySelectorAll("[data-radix-popper-content-wrapper]")
                .forEach(popper => popper.remove());
        });

        const floatingWidth = (container: HTMLElement) =>
            (container.querySelector(".z-20")?.querySelector("div") as HTMLElement).style.width;

        test("the drawer stays open while the popover is up", () => {
            const { container } = renderScaffold();
            const rail = container.querySelector(".z-20") as HTMLElement;
            enter(rail);
            expect(floatingWidth(container)).toBe("280px");

            openPopover();
            leave(rail);

            expect(floatingWidth(container)).toBe("280px");
        });

        test("and collapses once it closes, with no second mouseleave", async () => {
            const { container } = renderScaffold();
            const rail = container.querySelector(".z-20") as HTMLElement;
            enter(rail);

            const popper = openPopover();
            leave(rail);

            await act(async () => {
                popper.remove();
            });

            expect(floatingWidth(container)).toBe("72px");
        });

        test("but not when the pointer came back in the meantime", async () => {
            const { container } = renderScaffold();
            const rail = container.querySelector(".z-20") as HTMLElement;
            enter(rail);

            const popper = openPopover();
            leave(rail);
            enter(rail);

            await act(async () => {
                popper.remove();
            });

            expect(floatingWidth(container)).toBe("280px");
        });
    });
});
