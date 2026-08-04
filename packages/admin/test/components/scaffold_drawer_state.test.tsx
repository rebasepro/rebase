/**
 * @jest-environment jsdom
 */
import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("@rebasepro/app", () => ({
    // jsdom's matchMedia always reports false, which would send the real hook
    // down the small-layout (modal sheet) branch this suite is not about.
    useLargeLayout: () => true,
    useAdminModeController: () => ({ mode: "content" }),
    useTranslation: () => ({ t: (k: string) => k })
}));

import { Scaffold } from "../../src/components/app/Scaffold";
import { useApp } from "../../src/components/app/useApp";

const STORAGE_KEY = "rebase-drawer-open";

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

    test("hover does not expand the drawer unless autoOpenDrawer is set", () => {
        const { container } = renderScaffold();
        // The rail is the only element carrying the hover handlers.
        const rail = container.querySelector(".z-20") as HTMLElement;

        fireEvent.mouseEnter(rail);
        fireEvent.mouseMove(rail);

        expect(rail.style.width).toBe("72px");
        expect(rail.querySelector("div")?.style.width).toBe("72px");
    });

    test("hover expands the drawer when autoOpenDrawer is set", () => {
        const { container } = renderScaffold({ autoOpenDrawer: true });
        const rail = container.querySelector(".z-20") as HTMLElement;

        fireEvent.mouseEnter(rail);
        fireEvent.mouseMove(rail);

        // The floating panel widens; the layout column stays a rail.
        expect(rail.style.width).toBe("72px");
        expect(rail.querySelector("div")?.style.width).toBe("280px");
    });

    test("hovering never persists anything", () => {
        const { container } = renderScaffold({ autoOpenDrawer: true });
        fireEvent.mouseEnter(container.querySelector(".z-20") as HTMLElement);
        expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
});
