import type { NavigationEntry, NavigationResult } from "@rebasepro/types";
import React, { useMemo } from "react";

import { useCollapsedGroups, buildCollapsedDefaults, useLargeLayout, useAdminModeController, useEffectiveRoleController, useTranslation, useSlot, useRebaseContext, useAnalyticsController, useRebaseRegistry } from "@rebasepro/core";
import { useNavigationStateController, useUrlController } from "../hooks";


import { Link, useNavigate } from "react-router-dom";
import { AnalyticsEvent } from "@rebasepro/types";
import { cls, Tooltip, Typography , iconSize } from "@rebasepro/ui";
import { ChevronsLeftIcon, ChevronsRightIcon } from "lucide-react";
import { DrawerNavigationGroup } from "./DrawerNavigationGroup";
import { RebaseLogo } from "@rebasepro/core";
import { useApp } from "./app/useApp";

/**
 * Default drawer used in the CMS
 * @group Core
 */
export function DefaultDrawer({
    title,
    logo,
    logoDestination,
    className,
    style
}: {
    title?: React.ReactNode;
    logo?: string;
    logoDestination?: string;
    className?: string;
    style?: React.CSSProperties;
}) {

    const {
        drawerHovered,
        drawerOpen,
        openDrawer,
        closeDrawer,
        closeHover,
        logo: appLogo
    } = useApp();

    const resolvedLogo = logo ?? appLogo;

    const [adminMenuOpen, setAdminMenuOpen] = React.useState(false);
    const scrollRef = React.useRef<HTMLDivElement>(null);
    const [scrolled, setScrolled] = React.useState(false);

    const handleScroll = () => {
        if (scrollRef.current) {
            setScrolled(scrollRef.current.scrollTop > 0);
        }
    };

    const analyticsController = useAnalyticsController();
    const navigationState = useNavigationStateController();
    const context = useRebaseContext();

    const tooltipsOpen = drawerHovered && !drawerOpen && !adminMenuOpen;
    const largeLayout = useLargeLayout();
    const navigate = useNavigate();
    const adminModeController = useAdminModeController();
    const effectiveRoleController = useEffectiveRoleController();
    const registry = useRebaseRegistry();

    const adminViews = navigationState.topLevelNavigation?.navigationEntries.filter(e => e.type === "admin") ?? [];

    const allNavigationEntries = navigationState.topLevelNavigation?.navigationEntries ?? [];

    // Studio mode shows only view-type entries (devViews like schema editor).
    // Content mode shows collections and custom entries (everything except admin and studio views).
    const filteredEntries = adminModeController.mode === "studio"
        ? allNavigationEntries.filter(e => e.type === "view")
        : allNavigationEntries.filter(e => e.type !== "admin" && e.type !== "view");

    // Derive groups from the filtered entries
    const groupsToRender = [...new Set(filteredEntries.map(e => e.group).filter(Boolean))] as string[];

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

    const groups = navigationState.topLevelNavigation.groups;

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

    const isStudioDark = adminModeController.mode === "studio";
    const drawerVisuallyOpen = drawerOpen || drawerHovered;

    return (
        <>
            <div role="navigation" aria-label="Main navigation" className={cls("flex flex-col h-full relative grow w-full", className)} style={style}>

                <DrawerLogo
                    logo={resolvedLogo}
                    title={title}
                    logoDestination={logoDestination}
                    drawerOpen={drawerOpen}
                    drawerHovered={drawerHovered}
                />

                {registry.studioConfig && (
                    <DrawerModeSwitch
                        drawerOpen={drawerOpen}
                        drawerHovered={drawerHovered}
                    />
                )}

                {headerSlot}

                <div
                    ref={scrollRef}
                    onScroll={handleScroll}
                    className={"flex-grow min-h-0 overflow-y-auto overflow-x-hidden no-scrollbar"}
                    style={{
                        maskImage: scrolled
                            ? "linear-gradient(to bottom, transparent 0, black 20px, black calc(100% - 20px), transparent 100%)"
                            : "linear-gradient(to bottom, black 0, black calc(100% - 20px), transparent 100%)"
                    }}>

                    {groupsToRender.map((group) => {
                        const entriesInGroup = filteredEntries.filter(e => e.group === group);
                        return (
                            <DrawerNavigationGroup
                                key={`drawer_group_${group}`}
                                group={group}
                                entries={entriesInGroup}
                                collapsed={isGroupCollapsed(group)}
                                onToggleCollapsed={() => toggleGroupCollapsed(group)}
                                drawerOpen={drawerVisuallyOpen}
                                tooltipsOpen={tooltipsOpen}
                                adminMenuOpen={adminMenuOpen}
                                onItemClick={onItemClick}
                            />
                        );
                    })}

                </div>

                {footerSlot}

                <DrawerToggle
                    drawerOpen={drawerOpen}
                    drawerHovered={drawerHovered}
                    openDrawer={openDrawer}
                    closeDrawer={closeDrawer}
                />
            </div>

        </>
    );
}

export function DrawerLogo({
    logo,
    title,
    logoDestination,
    drawerOpen,
    drawerHovered
}: {
    logo?: string;
    title?: React.ReactNode;
    logoDestination?: string;
    drawerOpen: boolean;
    drawerHovered: boolean;
}) {

    const urlController = useUrlController();
    const showFullContent = drawerOpen || (drawerHovered && !drawerOpen);

    return (
        <div className="flex flex-row items-center shrink-0 pt-4 pb-0 px-2">
            {/* Logo — always visible */}
            <Link
                className="shrink-0 flex items-center justify-center w-[56px] h-[40px]"
                to={logoDestination || urlController.basePath}
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
                        to={logoDestination || urlController.basePath}
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
    const isFloating = isHovered;
    const showFullContent = isExpanded || isHovered;

    const { t } = useTranslation();

    return (
        <div className="shrink-0 mt-auto px-2 py-2">
            <Tooltip
                title={isExpanded ? t("collapse") : t("expand")}
                side="right"
                sideOffset={12}
                asChild={true}
                open={isFloating ? false : undefined}
            >
                <div
                    className={cls(
                        "flex flex-row items-center rounded-lg cursor-pointer",
                        "hover:bg-surface-accent-100 dark:hover:bg-surface-800",
                        "transition-colors duration-150",
                        "py-2"
                    )}
                    role="button"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    aria-label={isExpanded ? t("collapse") : t("expand")}
                    onClick={() => isExpanded ? closeDrawer() : openDrawer()}
                >
                    <div className="shrink-0 flex items-center justify-center w-[56px] h-[24px] text-surface-500 dark:text-surface-400">
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
                </div>
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
            <div role="group" aria-label="Content mode" className="flex bg-surface-100 dark:bg-surface-900 rounded-lg p-0.5 border border-surface-200 dark:border-surface-700/60">
                <button
                    onClick={() => {
                        adminModeController.setMode("content");
                        navigate(urlController.basePath ?? "/");
                    }}
                    aria-pressed={adminModeController.mode === "content"}
                    className={cls(
                        "flex-1 px-3 py-0.5 text-xs font-semibold rounded-md transition-all text-center",
                        adminModeController.mode === "content"
                            ? "bg-white dark:bg-surface-800 shadow-sm text-primary dark:text-primary-400"
                            : "text-surface-500 hover:text-surface-900 dark:hover:text-white"
                    )}
                >
                    Content
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
