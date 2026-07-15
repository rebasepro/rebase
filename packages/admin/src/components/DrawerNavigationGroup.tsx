import type { NavigationEntry } from "@rebasepro/types";
import React from "react";
import { ChevronDownIcon, cls, iconSize, Typography } from "@rebasepro/ui";

import { IconForView } from "@rebasepro/app";
import { DrawerNavigationItem } from "./DrawerNavigationItem";
import { useTranslation, useComponentOverride } from "@rebasepro/app";

export interface DrawerNavigationGroupProps {
    /**
     * Group name to display in header
     */
    group: string;
    /**
     * Navigation entries in this group
     */
    entries: NavigationEntry[];
    /**
     * Whether the group is collapsed
     */
    collapsed: boolean;
    /**
     * Callback when collapse state should toggle
     */
    onToggleCollapsed: () => void;
    /**
     * Whether the drawer is in open (expanded) state
     */
    drawerOpen: boolean;
    /**
     * Whether tooltips should be shown (drawer closed + hovered)
     */
    tooltipsOpen: boolean;
    /**
     * Whether admin menu is open (used to control tooltip visibility)
     */
    adminMenuOpen?: boolean;
    /**
     * Optional actions to render in the group header (e.g., "Add collection" button)
     */
    headerActions?: React.ReactNode;
    /**
     * Optional callback when a navigation item is clicked
     */
    onItemClick?: (entry: NavigationEntry) => void;
    /**
     * Hide the group header (title and expandable panel)
     */
    hideHeader?: boolean;
}

/**
 * Shared drawer navigation group component used by both DefaultDrawer and RebaseCloudDrawer.
 * Renders a collapsible group with header and navigation items.
 */
export function DrawerNavigationGroup({
    group,
    entries,
    collapsed,
    onToggleCollapsed,
    drawerOpen,
    tooltipsOpen,
    adminMenuOpen,
    headerActions,
    onItemClick,
    hideHeader
}: DrawerNavigationGroupProps) {
    const { t } = useTranslation();
    const ResolvedDrawerNavigationItem = useComponentOverride("Shell.DrawerNavigationItem", DrawerNavigationItem);
    return (
        <div
            className={"my-2 mx-2 flex flex-col"}
            key={`drawer_group_${group}`}
        >
            {/* Group Header */}
            {!hideHeader && (
                <div
                    className={cls("pl-3 pr-2 py-0.5 flex flex-row items-center transition-colors",
                        drawerOpen ? "cursor-pointer hover:bg-surface-100 dark:hover:bg-surface-800/40 rounded-lg" : "opacity-0 invisible pointer-events-none"
                    )}
                    onClick={drawerOpen ? onToggleCollapsed : undefined}
                >
                    <ChevronDownIcon
                        size={iconSize.small}
                        className={cls(
                            "text-surface-400 dark:text-surface-400 transition-transform duration-200 mr-1",
                            collapsed ? "-rotate-90" : "rotate-0"
                        )}
                    />
                    <Typography
                        variant={"caption"}
                        color={"secondary"}
                        className="font-semibold text-[11px] uppercase tracking-wider flex-grow line-clamp-1 text-surface-400 dark:text-surface-400"
                    >
                        {(group || t("views_group"))}
                    </Typography>
                    {headerActions && (
                        <div onClick={(e) => e.stopPropagation()}>
                            {headerActions}
                        </div>
                    )}
                </div>
            )}

            {/* Collapsible Content */}
            <div
                className={cls(
                    "transition-all duration-200 ease-in-out",
                    "overflow-hidden",
                    !hideHeader && "dark:bg-transparent",
                    "rounded-lg",
                    (!hideHeader && collapsed) ? "max-h-0 opacity-0" : "max-h-[2000px] opacity-100"
                )}
            >
                {entries.map((entry) => (
                    <ResolvedDrawerNavigationItem
                        key={entry.id}
                        icon={<IconForView collectionOrView={entry.collection ?? entry.view} size={"small"}/>}
                        tooltipsOpen={!collapsed && tooltipsOpen}
                        adminMenuOpen={adminMenuOpen}
                        drawerOpen={drawerOpen}
                        onClick={() => onItemClick?.(entry)}
                        url={entry.url}
                        name={entry.name}
                    />
                ))}
            </div>
        </div>
    );
}
