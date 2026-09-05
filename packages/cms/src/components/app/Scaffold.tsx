import React, { PropsWithChildren, useCallback, useMemo } from "react";
import { cls, defaultBorderMixin, IconButton, Sheet, Tooltip } from "@rebasepro/ui";
import { ChevronLeftIcon, ErrorBoundary, MenuIcon } from "@rebasepro/ui";
import { deepEqual as equal } from "fast-equals"

import { useLargeLayout, useAdminModeController, useTranslation } from "@rebasepro/app";
import { useUrlController } from "../../hooks/navigation/contexts/UrlContext";
import { AppContext } from "./useApp";

export const DRAWER_WIDTH = 280;

/**
 * Namespaced by base path: two admins served from one origin are two different
 * navigations, and a single key would have them overwrite each other's drawer.
 */
export function drawerOpenStorageKey(basePath: string | undefined) {
    return `rebase-drawer-open:${basePath || "/"}`;
}

/** `null` when the user has never toggled the drawer, or storage is unavailable. */
function readStoredDrawerOpen(key: string): boolean | null {
    if (typeof window === "undefined") return null;
    try {
        const stored = window.localStorage.getItem(key);
        return stored === null ? null : stored === "true";
    } catch (e) {
        // Storage can be blocked: private mode, sandboxed iframe, cookie policy.
        return null;
    }
}

function writeStoredDrawerOpen(key: string, open: boolean) {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(key, String(open));
    } catch (e) {
        // Same as above: a drawer that forgets is better than a crash.
    }
}

/**
 * @group Core
 */
export interface ScaffoldProps {

    /**
     * Expand the collapsed drawer while the pointer is over it. On by default —
     * pass `false` to keep the rail a rail until the user clicks the toggle.
     */
    autoOpenDrawer?: boolean;

    /**
     * Start with the drawer expanded rather than collapsed to icons.
     *
     * Distinct from {@link autoOpenDrawer}, which is a hover behaviour: this one
     * only seeds the very first visit. Once the user toggles the drawer, that
     * choice is stored in `localStorage` and wins over this prop on every load.
     *
     * Ignored on small layouts, where an expanded drawer covers the content it is
     * meant to navigate.
     */
    defaultDrawerOpen?: boolean;

    /**
     * Logo to be displayed in the top bar and drawer.
     * Note that this has no effect if you are using a custom AppBar or Drawer.
     */
    logo?: string;

    /**
     * If true, the main content will be padded in large layouts. Defaults to true.
     */
    padding?: boolean;

    className?: string;

    style?: React.CSSProperties;
}

/**
 * This view acts as a scaffold for Rebase.
 *
 * It is in charge of displaying the navigation drawer, top bar and main
 * collection views.
 * This component needs a parent {@link Rebase}
 *
 * @param props

 * @group Core
 */
export const Scaffold = React.memo<PropsWithChildren<ScaffoldProps>>(
    function Scaffold(props: PropsWithChildren<ScaffoldProps>) {

        const {
            children,
            autoOpenDrawer = true,
            defaultDrawerOpen = false,
            logo,
            className,
            style,
            padding = true
        } = props;

        // `toArray` keeps strings and numbers, and those have no `.type` at all.
        // Reading `child.type.componentType` off one threw a TypeError from
        // inside the layout, which is a bewildering way to be told that a stray
        // text node — a conditional that rendered `""`, a template string —
        // reached the Scaffold. Anything that is not an element is just "other".
        const slotOf = (child: React.ReactNode): string | undefined =>
            React.isValidElement(child)
                ? (child.type as { componentType?: string })?.componentType
                : undefined;

        const childArray = React.Children.toArray(children);
        const drawerChildren = childArray.filter((child) => slotOf(child) === "Drawer");
        if (drawerChildren.length > 1) {
            throw Error("Only one Drawer component is allowed in Scaffold");
        }
        const appBarChildren = childArray.filter((child) => slotOf(child) === "AppBar");
        if (appBarChildren.length > 1) {
            throw Error("Only one AppBar component is allowed in Scaffold");
        }
        const otherChildren = childArray
            .filter((child) => slotOf(child) !== "Drawer" && slotOf(child) !== "AppBar");
        const includeDrawer = drawerChildren.length > 0;
        const largeLayout = useLargeLayout();

        const storageKey = drawerOpenStorageKey(useUrlController().basePath);

        // Seeded once, deliberately: a `useEffect` syncing this to the prop would
        // re-expand the drawer under a user who had just collapsed it.
        const [drawerOpen, setDrawerOpenState] = React.useState(defaultDrawerOpen && largeLayout);
        const [onHover, setOnHover] = React.useState(false);

        // The stored choice is a client-only fact, so it is applied after the first
        // render rather than seeded into it: reading storage while rendering would
        // make the client disagree with server-rendered HTML. A layout effect runs
        // before paint, so the drawer still arrives in its remembered state.
        // `defaultDrawerOpen` seeds the very first visit and is ignored after that.
        React.useLayoutEffect(() => {
            const stored = readStoredDrawerOpen(storageKey);
            if (stored === null) return;
            setDrawerOpenState(stored && largeLayout);
            // Deliberately not re-run on `largeLayout`: crossing the breakpoint is
            // the effect below, and re-running here would undo a user's toggle.
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [storageKey]);

        // One piece of state drives two different things: the expanded rail on
        // large layouts, and the modal sheet on small ones. Carrying an expanded
        // rail across the breakpoint would drop that sheet, overlay and all, over
        // the content — so the crossing resets it, and widening again restores
        // whatever the user last chose.
        const wasLargeLayout = React.useRef(largeLayout);
        React.useEffect(() => {
            if (wasLargeLayout.current === largeLayout) return;
            wasLargeLayout.current = largeLayout;
            setDrawerOpenState(largeLayout ? (readStoredDrawerOpen(storageKey) ?? defaultDrawerOpen) : false);
        }, [largeLayout, defaultDrawerOpen, storageKey]);

        const setDrawerOpen = useCallback((open: boolean) => {
            setDrawerOpenState(open);
            // Small layouts render the drawer as a modal sheet. Remembering that
            // one would greet the next load with an overlay over the content.
            if (!largeLayout) return;
            writeStoredDrawerOpen(storageKey, open);
        }, [largeLayout, storageKey]);

        // The pointer has left, but a popover the drawer opened is still up, so the
        // collapse is owed rather than cancelled. See `setOnHoverFalse`.
        const collapseWhenPopoverCloses = React.useRef(false);

        const setOnHoverTrue = useCallback(() => {
            // Hover expansion is the default; `autoOpenDrawer={false}` opts out for
            // admins that want the rail to stay a rail until the toggle is clicked.
            if (!autoOpenDrawer) return;
            collapseWhenPopoverCloses.current = false;
            setOnHover(true);
        }, [autoOpenDrawer]);
        const setOnHoverFalse = useCallback(() => {
            // Don't collapse the drawer out from under an open popover/dropdown —
            // its content is portalled outside the drawer, so reaching for it reads
            // as a mouseleave. The collapse is owed until that popover closes.
            if (document.querySelector("[data-radix-popper-content-wrapper]")) {
                collapseWhenPopoverCloses.current = true;
                return;
            }
            collapseWhenPopoverCloses.current = false;
            setOnHover(false);
        }, []);

        // Nothing fires a second mouseleave when the popover finally closes, so the
        // owed collapse has to be noticed rather than waited for. Only mounted
        // while the drawer is actually floating open.
        React.useEffect(() => {
            if (!onHover) return;
            const collapseIfOwed = () => {
                if (!collapseWhenPopoverCloses.current) return;
                if (document.querySelector("[data-radix-popper-content-wrapper]")) return;
                collapseWhenPopoverCloses.current = false;
                setOnHover(false);
            };
            const observer = new MutationObserver(collapseIfOwed);
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
            return () => observer.disconnect();
        }, [onHover]);

        const handleDrawerOpen = useCallback(() => {
            setDrawerOpen(true);
        }, [setDrawerOpen]);

        const handleDrawerClose = useCallback(() => {
            setDrawerOpen(false);
        }, [setDrawerOpen]);

        const computedDrawerOpen: boolean = drawerOpen;
        const computedDrawerHovered = Boolean(largeLayout && onHover);

        const adminModeController = useAdminModeController();
        const isStudioDark = adminModeController.mode === "studio";


        const hasAppBar = Boolean(appBarChildren.length > 0);
        const appContextValue = useMemo(() => ({
            hasDrawer: Boolean(includeDrawer),
            drawerOpen: computedDrawerOpen,
            drawerHovered: computedDrawerHovered,
            openDrawer: handleDrawerOpen,
            closeDrawer: handleDrawerClose,
            closeHover: setOnHoverFalse,
            logo
        }), [includeDrawer, computedDrawerOpen, computedDrawerHovered, handleDrawerOpen, handleDrawerClose, setOnHoverFalse, logo]);

        return (
            <AppContext.Provider value={appContextValue}>
                <div
                    className={cls("flex h-screen w-screen overflow-hidden",
                        "bg-surface-50 dark:bg-surface-900",
                        "text-surface-900 dark:text-white", className)}
                    style={{
                        paddingTop: "env(safe-area-inset-top)",
                        paddingLeft: "env(safe-area-inset-left)",
                        paddingRight: "env(safe-area-inset-right)",
                        paddingBottom: "env(safe-area-inset-bottom)",
                        height: "100dvh",
                        ...style
                    }}>
                    {appBarChildren}

                    <DrawerWrapper
                        displayed={includeDrawer}
                        onMouseEnter={setOnHoverTrue}
                        onMouseMove={setOnHoverTrue}
                        onMouseLeave={setOnHoverFalse}
                        open={drawerOpen}
                        hovered={onHover}
                        isStudioDark={isStudioDark}
                        setDrawerOpen={setDrawerOpen}>
                        {includeDrawer && drawerChildren}
                    </DrawerWrapper>

                    <main
                        className="flex flex-col grow overflow-auto">

                        {hasAppBar && <DrawerHeader/>}

                        <div
                            className={cls(defaultBorderMixin, "bg-surface-50 dark:bg-surface-800", "grow overflow-auto m-0", {
                                "mt-1 lg:m-0 lg:mx-2 lg:mb-2 lg:rounded-lg lg:border-t lg:border-x lg:border-solid": padding,
                                // No app bar means no DrawerHeader spacer above, so inset the
                                // panel by the same amount as its sides and bottom.
                                // Must come after the padding classes, which reset lg margins.
                                "lg:mt-2": !hasAppBar && padding,
                                "lg:mt-4": !hasAppBar && !padding,
                                "border-t": hasAppBar && !padding
                            })}>

                            <ErrorBoundary>
                                {otherChildren}
                            </ErrorBoundary>

                        </div>
                    </main>
                </div>
            </AppContext.Provider>
        );
    },
    equal
)

const DrawerHeader = () => {
    return (
        <div className="flex flex-col min-h-14"></div>
    );
};

function DrawerWrapper(props: {
    children: React.ReactNode,
    displayed: boolean,
    open: boolean,
    logo?: string,
    hovered: boolean,
    isStudioDark: boolean,
    setDrawerOpen: (open: boolean) => void,
    onMouseEnter: () => void,
    onMouseMove: () => void,
    onMouseLeave: () => void
}) {

    const layoutWidth = !props.displayed ? 0 : (props.open ? DRAWER_WIDTH : 72);
    const visualWidth = !props.displayed ? 0 : ((props.open || props.hovered) ? DRAWER_WIDTH : 72);

    const isFloating = props.hovered && !props.open;
    const darkBg = "dark:bg-surface-900";
    const darkBgFloating = "dark:bg-surface-900";
    const { t } = useTranslation();

    const innerDrawer = <div
        className={cls("h-full overflow-hidden", defaultBorderMixin,
            isFloating ? `absolute top-0 left-0 bottom-0 z-50 bg-surface-50 ${darkBgFloating} shadow-lg border-r` : `relative bg-surface-50 ${darkBg}`)}
        style={{
            width: visualWidth,
            transition: "left 75ms cubic-bezier(0.4, 0, 0.6, 1) 0ms, opacity 75ms cubic-bezier(0.4, 0, 0.6, 1) 0ms, width 75ms cubic-bezier(0.4, 0, 0.6, 1) 0ms"
        }}
    >

        <div className={"flex flex-col h-full"}>
            {props.children}
        </div>

    </div>;

    const largeLayout = useLargeLayout();
    if (!largeLayout) {
        if (!props.displayed)
            return null;
        return <>
            <IconButton
                color="inherit"
                aria-label={t("open_menu")}
                onClick={() => props.setDrawerOpen(true)}
                className="absolute sm:top-2 sm:left-4 top-1 left-2"
            >
                <MenuIcon/>
            </IconButton>
            <Sheet side={"left"}
                transparent={true}
                open={props.open}
                onOpenChange={props.setDrawerOpen}
                title={t("navigation_drawer")}
                overlayClassName={"bg-white/80 dark:bg-surface-900/80"}
            >
                {innerDrawer}
            </Sheet>
        </>;
    }

    return (
        <div
            className="z-20 relative flex-shrink-0 overflow-visible"
            onMouseEnter={props.onMouseEnter}
            onMouseMove={props.onMouseMove}
            onMouseLeave={props.onMouseLeave}
            style={{
                width: layoutWidth,
                minWidth: layoutWidth,
                transition: "left 75ms cubic-bezier(0.4, 0, 0.6, 1) 0ms, opacity 75ms cubic-bezier(0.4, 0, 0.6, 1) 0ms, width 75ms cubic-bezier(0.4, 0, 0.6, 1) 0ms"
            }}>

            {innerDrawer}

        </div>
    );
}
