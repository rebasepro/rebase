/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, jest, test, beforeEach } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * The drawer's CMS / Studio switch is the kit's `ToggleButtonGroup`, not two
 * hand-rolled buttons: named in the app's language, `type="button"`, each
 * saying whether it is on. While the collapsed rail hides it (opacity 0), it
 * is `inert` — it used to stay in the tab order as two invisible tab stops.
 */

const navigateTo: string[] = [];
const setMode = jest.fn();

jest.mock("react-router", () => ({
    NavLink: ({ children, to, className, ...rest }: any) => (
        <a {...rest} href={to} className={typeof className === "function" ? className({ isActive: false }) : className}>{children}</a>
    ),
    Link: ({ children, to, ...rest }: any) => <a {...rest} href={to}>{children}</a>,
    useNavigate: () => (to: string) => { navigateTo.push(to); }
}));

const navigationState = {
    loading: false,
    topLevelNavigation: {
        navigationEntries: [{ id: "posts", url: "/c/posts", name: "Posts", type: "collection", group: "Content", collection: { slug: "posts", name: "Posts" } }],
        groups: ["Content"]
    }
};

jest.mock("@rebasepro/app", () => {
    const translation = { t: (key: string) => `t:${key}` };
    const registry = { cmsConfig: {}, studioConfig: {} };
    const adminMode = { mode: "cms", setMode: (mode: string) => setMode(mode) };
    const themeMode = { mode: "light", setMode: () => undefined };
    const auth = { user: null, initialLoading: false };
    const collapsed = { isGroupCollapsed: () => false, toggleGroupCollapsed: () => undefined };
    return {
        useTranslation: () => translation,
        useAnalyticsController: () => ({}),
        useRebaseContext: () => ({}),
        useRebaseRegistry: () => registry,
        useAdminModeController: () => adminMode,
        useModeController: () => themeMode,
        useAuthController: () => auth,
        useLargeLayout: () => true,
        useSlot: () => null,
        useCollapsedGroups: () => collapsed,
        buildCollapsedDefaults: () => ({}),
        useNavigationGroupLabel: () => (group: string) => group,
        useComponentOverride: (_slot: string, fallback: unknown) => fallback,
        IconForView: () => <svg/>,
        getIcon: () => undefined,
        LanguageToggle: () => null,
        RlsSimulatorBar: () => null,
        useCanSimulateAccess: () => false,
        RebaseLogo: () => null
    };
});

jest.mock("../../src/hooks/navigation/contexts/NavigationStateContext", () => ({
    useNavigationStateController: () => navigationState
}));

jest.mock("../../src/hooks/navigation/contexts/UrlContext", () => ({
    useUrlController: () => ({ basePath: "/" })
}));

import { DefaultDrawer } from "../../src/components/DefaultDrawer";
import { AppContext, AppState } from "../../src/components/app/useApp";

const noop = () => undefined;

function Shell({ drawerOpen, drawerHovered }: { drawerOpen: boolean, drawerHovered: boolean }) {
    const app = React.useMemo<AppState>(() => ({
        hasDrawer: true,
        drawerOpen,
        drawerHovered,
        openDrawer: noop,
        closeDrawer: noop,
        closeHover: noop
    }), [drawerOpen, drawerHovered]);
    return <AppContext.Provider value={app}><DefaultDrawer/></AppContext.Provider>;
}

beforeEach(() => {
    navigateTo.length = 0;
    setMode.mockClear();
});

describe("the drawer's CMS / Studio switch", () => {
    test("is a group named in the app's language, with pressed-state buttons", () => {
        render(<Shell drawerOpen={true} drawerHovered={false}/>);
        const group = screen.getByRole("group", { name: "t:panel_mode" });
        const cms = screen.getByRole("button", { name: "CMS" });
        const studio = screen.getByRole("button", { name: "Studio" });
        expect(group.contains(cms)).toBe(true);
        expect(cms.getAttribute("aria-pressed")).toBe("true");
        expect(studio.getAttribute("aria-pressed")).toBe("false");
        // A bare <button> inside a form would submit it.
        expect(cms.getAttribute("type")).toBe("button");
        expect(studio.getAttribute("type")).toBe("button");
    });

    test("switches mode and navigates", () => {
        render(<Shell drawerOpen={true} drawerHovered={false}/>);
        fireEvent.click(screen.getByRole("button", { name: "Studio" }));
        expect(setMode).toHaveBeenCalledWith("studio");
        expect(navigateTo).toEqual(["/s"]);
    });

    test("is inert while the collapsed rail hides it, and live again when it opens", () => {
        const { rerender } = render(<Shell drawerOpen={false} drawerHovered={false}/>);
        const hidden = screen.getByRole("group", { name: "t:panel_mode", hidden: true });
        expect(hidden.closest("[inert]")).not.toBeNull();

        rerender(<Shell drawerOpen={false} drawerHovered={true}/>);
        expect(screen.getByRole("group", { name: "t:panel_mode" }).closest("[inert]")).toBeNull();
    });
});
