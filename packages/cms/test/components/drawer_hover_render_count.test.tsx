/**
 * @jest-environment jsdom
 */
import React, { Profiler } from "react";
import { describe, expect, jest, test, beforeEach } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";

/**
 * Hovering the collapsed drawer re-renders no navigation row.
 *
 * The rail floats open under the pointer. That used to flow down as a prop to
 * every group and every row — each a router link and a tooltip — so crossing
 * the rail re-rendered every row twice (in and out), linear in the number of
 * collections: 200 collections cost ~22 ms of React work per crossing (dev).
 * The rows now follow the drawer through a `data-expanded` attribute on it and
 * CSS, and only a row whose tooltip is up listens for the drawer opening, to
 * mask it. Group headers (a handful) still re-render; rows do not.
 */

let rowRenders = 0;

// Each row renders one router link per render, so the links count the rows.
jest.mock("react-router", () => ({
    NavLink: ({ children, className, to, ...rest }: any) => {
        rowRenders++;
        return (
            <a {...rest} href={to}
                className={typeof className === "function" ? className({ isActive: false }) : className}>
                {children}
            </a>
        );
    },
    Link: ({ children, to, ...rest }: any) => <a {...rest} href={to}>{children}</a>,
    useNavigate: () => () => undefined
}));

const GROUPS = 10;
const PER_GROUP = 20;
const groups = Array.from({ length: GROUPS }, (_, g) => `Group ${g}`);
const navigationEntries = groups.flatMap((group, g) => Array.from({ length: PER_GROUP }, (_, i) => ({
    id: `c${g}_${i}`,
    url: `/c/c${g}_${i}`,
    name: `Collection ${g}-${i}`,
    type: "collection",
    group,
    collection: { slug: `c${g}_${i}`, name: `Collection ${g}-${i}` }
})));
const navigationState = { loading: false, topLevelNavigation: { navigationEntries, groups } };

/** An app override of the drawer row, to check what overrides are still handed. */
const overrideDrawerOpen: boolean[] = [];
let overrideItem = false;
function OverrideItem({ drawerOpen, name }: { drawerOpen: boolean, name: string }) {
    overrideDrawerOpen.push(drawerOpen);
    return <span>{name}</span>;
}

jest.mock("@rebasepro/app", () => {
    const t = (key: string) => key;
    const translation = { t };
    const analytics = {};
    const context = {};
    const registry = { cmsConfig: {} };
    const adminMode = { mode: "cms", setMode: () => undefined };
    const themeMode = { mode: "light", setMode: () => undefined };
    const auth = { user: null, initialLoading: false };
    const collapsed = { isGroupCollapsed: () => false, toggleGroupCollapsed: () => undefined };
    const groupLabel = (group: string) => group;
    return {
        useTranslation: () => translation,
        useAnalyticsController: () => analytics,
        useRebaseContext: () => context,
        useRebaseRegistry: () => registry,
        useAdminModeController: () => adminMode,
        useModeController: () => themeMode,
        useAuthController: () => auth,
        useLargeLayout: () => true,
        useSlot: () => null,
        useCollapsedGroups: () => collapsed,
        buildCollapsedDefaults: () => ({}),
        useNavigationGroupLabel: () => groupLabel,
        useComponentOverride: (slot: string, fallback: unknown) =>
            (overrideItem && slot === "Shell.DrawerNavigationItem") ? OverrideItem : fallback,
        IconForView: () => <svg/>,
        getIcon: () => undefined,
        LanguageToggle: () => null,
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

function Shell({ drawerOpen, drawerHovered, onRender }: {
    drawerOpen: boolean,
    drawerHovered: boolean,
    onRender?: React.ProfilerOnRenderCallback
}) {
    // The value Scaffold builds: a new object when the hover changes.
    const app = React.useMemo<AppState>(() => ({
        hasDrawer: true,
        drawerOpen,
        drawerHovered,
        openDrawer: noop,
        closeDrawer: noop,
        closeHover: noop
    }), [drawerOpen, drawerHovered]);
    return (
        <AppContext.Provider value={app}>
            <Profiler id={"drawer"} onRender={onRender ?? noop}>
                <DefaultDrawer/>
            </Profiler>
        </AppContext.Provider>
    );
}

beforeEach(() => {
    rowRenders = 0;
    overrideItem = false;
    overrideDrawerOpen.length = 0;
});

describe("hovering the collapsed drawer", () => {

    test("re-renders no navigation row, in or out (200 collections)", () => {
        let commits = 0;
        let workMs = 0;
        const onRender: React.ProfilerOnRenderCallback = (_id, _phase, actualDuration) => {
            commits++;
            workMs += actualDuration;
        };
        const { rerender } = render(<Shell drawerOpen={false} drawerHovered={false} onRender={onRender}/>);
        expect(rowRenders).toBe(GROUPS * PER_GROUP);

        rowRenders = 0;
        commits = 0;
        workMs = 0;
        const TOGGLES = 10;
        for (let i = 0; i < TOGGLES; i++) {
            rerender(<Shell drawerOpen={false} drawerHovered={i % 2 === 0} onRender={onRender}/>);
        }
        // Reported for the commit message; the assertion is the row count.
        console.log(`[drawer hover] ${GROUPS * PER_GROUP} entries: ${commits} commits, ${(workMs / TOGGLES).toFixed(2)} ms of React work per hover change`);
        expect(rowRenders).toBe(0);
    });

    test("the drawer says whether it is open, for the rows' labels to follow", () => {
        const { container, rerender } = render(<Shell drawerOpen={false} drawerHovered={false}/>);
        const drawer = container.querySelector("[role='navigation']")!;
        expect(drawer.getAttribute("data-expanded")).toBe("false");

        rerender(<Shell drawerOpen={false} drawerHovered={true}/>);
        expect(drawer.getAttribute("data-expanded")).toBe("true");

        rerender(<Shell drawerOpen={true} drawerHovered={false}/>);
        expect(drawer.getAttribute("data-expanded")).toBe("true");
    });

    test("a row's tooltip opens on the bare rail, and not once the drawer is open under it", async () => {
        const { rerender } = render(<Shell drawerOpen={false} drawerHovered={false}/>);
        const link = screen.getByRole("link", { name: "Collection 0-0" });

        fireEvent.focus(link);
        expect((await screen.findByRole("tooltip")).textContent).toContain("Collection 0-0");

        // The rail floats open under the pointer: the label says it now.
        rerender(<Shell drawerOpen={false} drawerHovered={true}/>);
        expect(screen.queryByRole("tooltip")).toBeNull();

        // And a row focused while the drawer is open shows none.
        fireEvent.blur(link);
        fireEvent.focus(screen.getByRole("link", { name: "Collection 1-3" }));
        expect(screen.queryByRole("tooltip")).toBeNull();
    });

    test("an app's own row (Shell.DrawerNavigationItem) is still told the drawer is open", () => {
        overrideItem = true;
        const { rerender } = render(<Shell drawerOpen={false} drawerHovered={false}/>);
        expect(overrideDrawerOpen.every(open => !open)).toBe(true);

        overrideDrawerOpen.length = 0;
        act(() => {
            rerender(<Shell drawerOpen={false} drawerHovered={true}/>);
        });
        expect(overrideDrawerOpen.length).toBe(GROUPS * PER_GROUP);
        expect(overrideDrawerOpen.every(open => open)).toBe(true);
    });
});
