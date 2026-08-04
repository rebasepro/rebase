/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";

// react-router 8 is ESM-only and ts-jest cannot load it. The link is not what
// this suite is about — only the tooltip wrapped around it.
jest.mock("react-router", () => ({
    NavLink: ({ children, className, to, ...rest }: any) => (
        <a
            {...rest}
            href={to}
            className={typeof className === "function" ? className({ isActive: false }) : className}
        >
            {children}
        </a>
    )
}));

import { DrawerNavigationItem } from "../../src/components/DrawerNavigationItem";

const item = (drawerOpen: boolean) => (
    <DrawerNavigationItem
        name="Products"
        icon={<svg/>}
        drawerOpen={drawerOpen}
        url="/c/products"
    />
);

function renderItem(drawerOpen: boolean) {
    return render(item(drawerOpen));
}

describe("DrawerNavigationItem tooltip", () => {

    test("a bare rail names its icons — the tooltip opens on focus", async () => {
        renderItem(false);

        fireEvent.focus(screen.getByRole("link"));

        expect((await screen.findByRole("tooltip")).textContent).toContain("Products");
    });

    test("no tooltip once the label is visible", () => {
        renderItem(true);

        fireEvent.focus(screen.getByRole("link"));

        expect(screen.queryByRole("tooltip")).toBeNull();
    });

    test("an open tooltip is not stranded by the drawer expanding under it", async () => {
        const { rerender } = renderItem(false);
        fireEvent.focus(screen.getByRole("link"));
        expect(await screen.findByRole("tooltip")).toBeTruthy();

        rerender(item(true));

        expect(screen.queryByRole("tooltip")).toBeNull();
    });
});
