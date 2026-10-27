/**
 * @jest-environment jsdom
 */
/**
 * One "Simulate access" control per screen.
 *
 * The app bar and the drawer each rendered the pill. On a large layout the
 * drawer is always there (a rail or open), so `<RebaseShell appBar={<AppBar/>}>`
 * showed the pill in the top bar and again above the avatar. The drawer's
 * control is the one kept there; the app bar carries it where no drawer is
 * on screen: no drawer at all, or a small layout, where the drawer is a sheet.
 */
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";

const mockLayout = { hasDrawer: true, largeLayout: true };

jest.mock("@rebasepro/app", () => ({
    useSlot: () => [],
    useRebaseContext: () => ({}),
    useAuthController: () => ({ user: { uid: "u1", displayName: "Ada" }, signOut: async () => undefined }),
    useLargeLayout: () => mockLayout.largeLayout,
    useModeController: () => ({ mode: "light", setMode: () => undefined }),
    useAdminModeController: () => ({ mode: "cms" }),
    useTranslation: () => ({ t: (k: string) => k }),
    RebaseLogo: () => <svg/>,
    LanguageToggle: () => <span/>,
    RlsSimulatorBar: () => <span data-testid={"simulate-access"}/>,
    UserSettingsView: () => <span/>
}));
jest.mock("../../src/hooks/navigation/contexts/UrlContext", () => ({
    useUrlController: () => ({ basePath: "/" })
}));
jest.mock("../../src/components/app/useApp", () => ({
    useApp: () => ({ hasDrawer: mockLayout.hasDrawer, drawerOpen: false, logo: undefined })
}));
jest.mock("../../src/hooks/useBreadcrumbsController", () => ({
    useBreadcrumbsController: () => ({ breadcrumbs: [] })
}));

import { MemoryRouter } from "react-router";
import { DefaultAppBar } from "../../src/components/DefaultAppBar";

function pillsInAppBar(): number {
    render(<MemoryRouter><DefaultAppBar title={"Admin"}/></MemoryRouter>);
    return screen.queryAllByTestId("simulate-access").length;
}

beforeEach(() => {
    mockLayout.hasDrawer = true;
    mockLayout.largeLayout = true;
});

describe("the app bar's Simulate access control", () => {
    it("is left to the drawer on a large layout, where the drawer always shows one", () => {
        expect(pillsInAppBar()).toBe(0);
    });

    it("is there on a small layout, where the drawer is a closed sheet", () => {
        mockLayout.largeLayout = false;
        expect(pillsInAppBar()).toBe(1);
    });

    it("is there when the shell has no drawer", () => {
        mockLayout.hasDrawer = false;
        expect(pillsInAppBar()).toBe(1);
    });
});
