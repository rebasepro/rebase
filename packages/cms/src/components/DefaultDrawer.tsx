import type { NavigationEntry, NavigationResult } from "@rebasepro/cms-types";
import React, { useMemo } from "react";

import { useCollapsedGroups, buildCollapsedDefaults, useLargeLayout, useAdminModeController, useAuthController, useModeController, useTranslation, useSlot, useRebaseContext, useAnalyticsController, useRebaseRegistry, useComponentOverride } from "@rebasepro/app";
import { useUrlController } from "../hooks/navigation/contexts/UrlContext";
import { useNavigationStateController } from "../hooks/navigation/contexts/NavigationStateContext";


import { Link, useNavigate } from "react-router";
import { AnalyticsEvent } from "@rebasepro/cms-types";
import {
    Avatar,
    ChevronsLeftIcon,
    ChevronsRightIcon,
    cls,
    iconSize,
    IconButton,
    LanguagesIcon,
    LogOutIcon,
    Menu,
    MenuItem,
    MoonIcon,
    Separator,
    SettingsIcon,
    Skeleton,
    SunIcon,
    SunMoonIcon,
    Tooltip,
    Typography
} from "@rebasepro/ui";
import { DrawerNavigationGroup } from "./DrawerNavigationGroup";
import { LanguageToggle, RebaseLogo } from "@rebasepro/app";
import { useApp } from "./app/useApp";

/**
 * Default drawer used in the admin.
 *
 * When no `children` are provided, renders the full admin navigation
 * (collection groups, mode switch, plugin slots).
 *
 * When `children` **are** provided, renders the shared drawer shell
 * (logo, scrollable area, footer actions, collapse toggle) with the
 * custom content injected in the scrollable area. This lets consumers
 * like the SaaS dashboard reuse the identical structural layout while
 * supplying their own navigation items.
 *
 * @group Core
 */
export function DefaultDrawer({
    title,
    logo,
    logoDestination,
    children,
    footerActions,
    className,
    style
}: {
    title?: React.ReactNode;
    logo?: string;
    logoDestination?: string;
    /**
     * Custom navigation content for the drawer.
     * When provided, replaces the default admin navigation (collection groups,
     * mode switch, slots). The shared shell (logo, scroll area, footer
     * actions, collapse toggle) is still rendered around it.
     */
    children?: React.ReactNode;
    /**
     * Custom content for the drawer footer actions area (language, theme, user menu).
     * - `undefined` — renders the default `DrawerFooterActions`.
     * - `null` — renders nothing (hides the footer actions).
     * - `ReactNode` — renders the provided custom content.
     */
    footerActions?: React.ReactNode | null;
    className?: string;
    style?: React.CSSProperties;
}) {

    const {
        drawerHovered,
        drawerOpen,
        openDrawer,
        closeDrawer,
        logo: appLogo
    } = useApp();

    const resolvedLogo = logo ?? appLogo;

    const scrollRef = React.useRef<HTMLDivElement>(null);
    const [scrolled, setScrolled] = React.useState(false);

    const handleScroll = () => {
        if (scrollRef.current) {
            setScrolled(scrollRef.current.scrollTop > 0);
        }
    };

    return (
        <div role="navigation" aria-label="Main navigation" className={cls("flex flex-col h-full relative grow w-full", className)} style={style}>

            <DrawerLogo
                logo={resolvedLogo}
                title={title}
                logoDestination={logoDestination}
                drawerOpen={drawerOpen}
                drawerHovered={drawerHovered}
            />

            <div
                ref={scrollRef}
                onScroll={handleScroll}
                className={"flex-grow min-h-0 overflow-y-auto overflow-x-hidden no-scrollbar px-2"}
                style={{
                    maskImage: scrolled
                        ? "linear-gradient(to bottom, transparent 0, black 20px, black calc(100% - 20px), transparent 100%)"
                        : "linear-gradient(to bottom, black 0, black calc(100% - 20px), transparent 100%)"
                }}>
                {children ?? <AdminNavigationContent />}
            </div>

            {footerActions !== null && (
                footerActions !== undefined
                    ? footerActions
                    : <DrawerFooterActions
                        drawerOpen={drawerOpen}
                        drawerHovered={drawerHovered}
                    />
            )}

            <DrawerToggle
                drawerOpen={drawerOpen}
                drawerHovered={drawerHovered}
                openDrawer={openDrawer}
                closeDrawer={closeDrawer}
            />
        </div>
    );
}

/**
 * Default admin navigation content — rendered inside DefaultDrawer when no
 * custom `children` are provided.  Contains the mode switch, navigation
 * groups, and header / footer plugin slots.
 */
function AdminNavigationContent() {

    const {
        drawerHovered,
        drawerOpen,
        closeDrawer,
        closeHover
    } = useApp();

    const analyticsController = useAnalyticsController();
    const navigationState = useNavigationStateController();
    const context = useRebaseContext();

    const largeLayout = useLargeLayout();
    const adminModeController = useAdminModeController();
    const registry = useRebaseRegistry();
    const ResolvedDrawerNavigationGroup = useComponentOverride("Shell.DrawerNavigationGroup", DrawerNavigationGroup);

    const allNavigationEntries = navigationState.topLevelNavigation?.navigationEntries ?? [];

    // Build a set of Studio-only dev view slugs so we can distinguish them from
    // admin custom views added via <RebaseCMS views={...}> or plugins.
    const studioViewSlugs = useMemo(() => {
        const slugs = new Set<string>();
        (registry.studioConfig?.devViews ?? []).forEach(v => slugs.add(v.slug));
        // The schema view is also a Studio dev view (auto-injected when collectionEditor is enabled)
        if (registry.studioConfig && registry.cmsConfig?.collectionEditor) slugs.add("schema");
        return slugs;
    }, [registry.studioConfig, registry.cmsConfig?.collectionEditor]);

    // Studio mode shows Studio dev views + admin entries (Users/Roles).
    // Content mode shows collections, admin custom views, and admin entries — but not Studio dev views.
    const filteredEntries = adminModeController.mode === "studio"
        ? allNavigationEntries.filter(e => (e.type === "view" && studioViewSlugs.has(e.slug)) || e.type === "admin")
        : allNavigationEntries.filter(e => e.type !== "view" || !studioViewSlugs.has(e.slug));

    // Derive groups from the filtered entries, preserving the order from topLevelNavigation.groups
    const entryGroups = new Set(filteredEntries.map(e => e.group).filter(Boolean));
    const orderedGroups = navigationState.topLevelNavigation?.groups ?? [];
    const groupsToRender = [
        ...orderedGroups.filter(g => entryGroups.has(g)),
        ...[...entryGroups].filter(g => !orderedGroups.includes(g))
    ];

    // Group header icons, declared on `navigationGroupMappings`. Keyed by name
    // because that is what a navigation entry's `group` holds.
    const groupIcons = useMemo(() => {
        const icons = new Map<string, string>();
        (registry.cmsConfig?.navigationGroupMappings ?? []).forEach(mapping => {
            if (mapping.icon) icons.set(mapping.name, mapping.icon);
        });
        return icons;
    }, [registry.cmsConfig?.navigationGroupMappings]);

    // Collapsible groups state - using "drawer" namespace for independent state from home page
    const collapsedDefaults = useMemo(
        () => buildCollapsedDefaults(registry.cmsConfig?.navigationGroupMappings, "drawer"),
        [registry.cmsConfig?.navigationGroupMappings]
    );
    const { isGroupCollapsed, toggleGroupCollapsed } = useCollapsedGroups(groupsToRender, "drawer", collapsedDefaults);

    const headerSlot = useSlot("navigation.header", { drawerOpen,
drawerHovered,
context });
    const footerSlot = useSlot("navigation.footer", { drawerOpen,
drawerHovered,
context });

    if (!navigationState.topLevelNavigation)
        return null;

    const onItemClick = (view: NavigationEntry) => {
        const eventName: AnalyticsEvent = view.type === "collection"
            ? "drawer_navigate_to_collection"
            : (view.type === "view" ? "drawer_navigate_to_view" : "unmapped_event");
        analyticsController.onAnalyticsEvent?.(eventName, { url: view.url });
        if (!largeLayout) {
            closeDrawer();
        } else if (!drawerOpen) {
            closeHover();
        }
    };

    const drawerVisuallyOpen = drawerOpen || drawerHovered;

    return (
        <>
            {registry.studioConfig && (
                <DrawerModeSwitch
                    drawerOpen={drawerOpen}
                    drawerHovered={drawerHovered}
                />
            )}

            {headerSlot}

            {groupsToRender.map((group) => {
                const entriesInGroup = filteredEntries.filter(e => e.group === group);
                return (
                    <ResolvedDrawerNavigationGroup
                        key={`drawer_group_${group}`}
                        group={group}
                        entries={entriesInGroup}
                        collapsed={isGroupCollapsed(group)}
                        onToggleCollapsed={() => toggleGroupCollapsed(group)}
                        drawerOpen={drawerVisuallyOpen}
                        onItemClick={onItemClick}
                        icon={groupIcons.get(group)}
                    />
                );
            })}

            {footerSlot}
        </>
    );
}

export function DrawerLogo({
    logo,
    title,
    logoDestination = "/",
    drawerOpen,
    drawerHovered
}: {
    logo?: string;
    title?: React.ReactNode;
    logoDestination?: string;
    drawerOpen: boolean;
    drawerHovered: boolean;
}) {

    const showFullContent = drawerOpen || drawerHovered;
    const { t } = useTranslation();

    return (
        <div className="flex flex-row items-center shrink-0 pt-4 pb-0 px-2">
            {/* Logo — always visible */}
            {/* Named explicitly because neither branch below carries text: the
                stock `RebaseLogo` is a bare <svg> with no <title>, and a custom
                `logo` only ever gets the generic alt "Logo", which names the image
                rather than saying where the link goes. The title link beside it is
                no help either — it renders only when a `title` is set. */}
            <Link
                className="shrink-0 flex items-center justify-center w-[56px] h-[40px]"
                to={logoDestination}
                aria-label={t("home") || "Home"}
            >
                {logo
                    ? <img src={logo} alt="Logo" className="w-[28px] h-[28px] object-contain"/>
                    : <RebaseLogo width="28px" height="28px"/>
                }
            </Link>

            {/* Title (fades in when expanded or hovered) */}
            <div
                className={cls(
                    "flex flex-row items-center overflow-hidden transition-all duration-200 ease-in-out",
                    showFullContent ? "opacity-100 w-full ml-1" : "opacity-0 w-0 ml-0"
                )}
            >
                {title && (
                    <Link
                        className="visited:text-inherit dark:visited:text-inherit block truncate"
                        to={logoDestination}
                    >
                        {typeof title === "string"
                            ? <Typography variant="subtitle1" noWrap className="truncate">{title}</Typography>
                            : title
                        }
                    </Link>
                )}
            </div>
        </div>
    );
}

/**
 * Toggle button at the bottom of the drawer.
 * Uses double-chevron icons to indicate collapse/expand direction.
 */
export function DrawerToggle({
    drawerOpen,
    drawerHovered,
    openDrawer,
    closeDrawer
}: {
    drawerOpen: boolean;
    drawerHovered: boolean;
    openDrawer: () => void;
    closeDrawer: () => void;
}) {
    const isExpanded = drawerOpen;
    const isHovered = drawerHovered && !drawerOpen;
    const showFullContent = isExpanded || isHovered;

    const [wantsTooltip, setWantsTooltip] = React.useState(false);
    // See {@link DrawerNavigationItem}: a masked tooltip never hears the pointer
    // leave, so the stale state is dropped as the mask goes on.
    if (showFullContent && wantsTooltip) setWantsTooltip(false);

    const { t } = useTranslation();

    return (
        <div className="shrink-0 mt-auto px-4 pt-0.5 pb-2">
            <Tooltip
                title={isExpanded ? t("collapse") : t("expand")}
                // The row spells out "Collapse"/"Expand" itself whenever it is wide
                // enough to show the label — expanded, or floating open under the
                // pointer. A tooltip repeating that word is noise; it earns its
                // place only on a bare rail, where the chevron stands alone.
                //
                // Masked, not withheld: see {@link DrawerNavigationItem} for why
                // this stays controlled in both states.
                open={!showFullContent && wantsTooltip}
                onOpenChange={setWantsTooltip}
                side="right"
                sideOffset={12}
                asChild={true}
            >
                <button
                    type="button"
                    className={cls(
                        "flex flex-row items-center rounded-lg cursor-pointer w-full",
                        "hover:bg-surface-accent-100 dark:hover:bg-surface-800",
                        "transition-colors duration-150",
                        "py-2"
                    )}
                    aria-expanded={isExpanded}
                    aria-label={isExpanded ? t("collapse") : t("expand")}
                    onClick={() => isExpanded ? closeDrawer() : openDrawer()}
                >
                    <div className="shrink-0 flex items-center justify-center w-[44px] h-[24px] text-surface-500 dark:text-surface-400">
                        {isExpanded
                            ? <ChevronsLeftIcon size={iconSize.small}/>
                            : <ChevronsRightIcon size={iconSize.small}/>
                        }
                    </div>
                    <div className={cls(
                        "overflow-hidden transition-all duration-200 ease-in-out",
                        showFullContent ? "opacity-100 w-auto" : "opacity-0 w-0"
                    )}>
                        <Typography
                            variant="body2"
                            className="text-surface-500 dark:text-surface-400 select-none whitespace-nowrap"
                        >
                            {isExpanded ? t("collapse") : t("expand")}
                        </Typography>
                    </div>
                </button>
            </Tooltip>
        </div>
    );
}

/**
 * Segmented Content / Studio switch rendered inside the drawer.
 * Animates in/out with the drawer open state via opacity + max-height.
 */
function DrawerModeSwitch({
    drawerOpen,
    drawerHovered
}: {
    drawerOpen: boolean;
    drawerHovered: boolean;
}) {
    const adminModeController = useAdminModeController();
    const urlController = useUrlController();
    const navigate = useNavigate();
    const showSwitch = drawerOpen || drawerHovered;

    return (
        <div
            className={cls(
                "shrink-0 overflow-hidden transition-all duration-200 ease-in-out px-3",
                showSwitch ? "opacity-100 h-7 mt-2 mb-0" : "opacity-0 pointer-events-none h-7 mt-2 mb-0"
            )}
        >
            <div role="group" aria-label="Panel mode" className="flex bg-surface-100 dark:bg-surface-900 rounded-lg p-0.5 border border-surface-200 dark:border-surface-700/60">
                <button
                    onClick={() => {
                        adminModeController.setMode("cms");
                        navigate(urlController.basePath ?? "/");
                    }}
                    aria-pressed={adminModeController.mode === "cms"}
                    className={cls(
                        "flex-1 px-3 py-0.5 text-xs font-semibold rounded-md transition-all text-center",
                        adminModeController.mode === "cms"
                            ? "bg-white dark:bg-surface-800 shadow-sm text-primary dark:text-primary-400"
                            : "text-surface-500 hover:text-surface-900 dark:hover:text-white"
                    )}
                >
                    CMS
                </button>
                <button
                    onClick={() => {
                        adminModeController.setMode("studio");
                        navigate(urlController.basePath === "/" ? "/s" : `${urlController.basePath ?? ""}/s`);
                    }}
                    aria-pressed={adminModeController.mode === "studio"}
                    className={cls(
                        "flex-1 px-3 py-0.5 text-xs font-semibold rounded-md transition-all text-center",
                        adminModeController.mode === "studio"
                            ? "bg-white dark:bg-surface-800 shadow-sm text-primary dark:text-primary-400"
                            : "text-surface-500 hover:text-surface-900 dark:hover:text-white"
                    )}
                >
                    Studio
                </button>
            </div>
        </div>
    );
}

/**
 * Footer actions rendered at the bottom of the drawer, above the collapse/expand toggle.
 * Replaces the app bar icons (language, theme, user avatar) with a drawer-native layout
 * that adapts between collapsed (icons only) and expanded (full labels + user bar) states.
 *
 * @group Core
 */
export function DrawerFooterActions({
    drawerOpen,
    drawerHovered,
    /**
     * Custom content to render inside the user dropdown menu.
     * When provided, these items are appended after the user info header
     * and before the default Sign Out item.
     */
    dropDownActions,
    /**
     * Override the user object displayed in the footer.
     * When omitted, falls back to `authController.user`.
     */
    user: userProp
}: {
    drawerOpen: boolean;
    drawerHovered: boolean;
    dropDownActions?: React.ReactNode;
    user?: import("@rebasepro/types").User;
}) {
    const authController = useAuthController();
    const {
        mode,
        setMode
    } = useModeController();
    const navigate = useNavigate();
    const { t } = useTranslation();

    const user = userProp ?? authController.user;
    const showFullContent = drawerOpen || drawerHovered;
    const isFloating = drawerHovered && !drawerOpen;
    const portalRef = React.useRef<HTMLDivElement>(null);

    // User avatar
    let avatarComponent: React.ReactElement | null;
    if (user) {
        const initial = user?.displayName
            ? user.displayName[0].toUpperCase()
            : (user?.email ? user.email[0].toUpperCase() : "A");
        avatarComponent = <Avatar src={user.photoURL ?? undefined} className="w-8 h-8 text-xs">
            {initial}
        </Avatar>;
    } else if (user === undefined || authController.initialLoading) {
        avatarComponent = <Skeleton className="w-8 h-8 rounded-full"/>;
    } else {
        avatarComponent = null;
    }

    return (
        <div className="shrink-0 pt-2 pb-0" ref={portalRef}>
            {avatarComponent && (
                <div className="flex items-center px-[16px] py-1">
                    <Menu
                        trigger={
                            <div
                                className={cls(
                                    "shrink-0 flex items-center justify-center w-[44px] cursor-pointer",
                                    "rounded-md py-1",
                                    "hover:bg-surface-accent-100 dark:hover:bg-surface-800",
                                    "transition-colors duration-150"
                                )}
                                role="button"
                                tabIndex={0}
                                aria-label={t("user_menu") || "User menu"}
                            >
                                {avatarComponent}
                            </div>
                        }
                        side="top"
                        align="start"
                    >
                        {user && <div className="px-4 py-2 mb-1">
                            {user.displayName && <Typography variant="body1" color="secondary">
                                {user.displayName}
                            </Typography>}
                            {user.email && <Typography variant="body2" color="secondary">
                                {user.email}
                            </Typography>}
                        </div>}

                        {dropDownActions}

                        {!dropDownActions && <>
                            <MenuItem onClick={() => navigate("/settings")}>
                                <SettingsIcon/>
                                {t("account_settings")}
                            </MenuItem>
                            <MenuItem onClick={async () => {
                                await authController.signOut();
                                navigate("/");
                            }}>
                                <LogOutIcon/>
                                {t("log_out")}
                            </MenuItem>
                        </>}
                    </Menu>

                    {/* Language + Theme — only when expanded */}
                    {showFullContent && (
                        <div className="flex items-center gap-0">
                            <LanguageToggle/>
                            <Menu
                                trigger={
                                    <IconButton
                                        color="inherit"
                                        aria-label={t("toggle_theme") || "Toggle theme"}
                                        className="text-surface-500 dark:text-surface-400"
                                    >
                                        {mode === "dark"
                                            ? <MoonIcon size={iconSize.small}/>
                                            : mode === "light"
                                                ? <SunIcon size={iconSize.small}/>
                                                : <SunMoonIcon size={iconSize.small}/>}
                                    </IconButton>
                                }
                                portalContainer={portalRef.current}
                                side="top"
                            >
                                <MenuItem onClick={() => setMode("dark")}><MoonIcon size={iconSize.smallest}/> {t("dark_mode")}</MenuItem>
                                <MenuItem onClick={() => setMode("light")}><SunIcon size={iconSize.smallest}/> {t("light_mode")}</MenuItem>
                                <MenuItem onClick={() => setMode("system")}><SunMoonIcon size={iconSize.smallest}/> {t("system_mode")}</MenuItem>
                            </Menu>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
