import type { NavigationEntry } from "@rebasepro/admin-types";
import React from "react";
import { ChevronDownIcon, cls, iconSize, Typography } from "@rebasepro/ui";

import { IconForView, getIcon } from "@rebasepro/app";
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
    /**
     * Lucide icon name for the group header, from `NavigationGroupMapping.icon`.
     *
     * Supplying one moves the visual anchor from the rows to the group: the header
     * gets the icon, and the entries below trade theirs for an indent.
     */
    icon?: string;
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
    hideHeader,
    icon
}: DrawerNavigationGroupProps) {
    const { t } = useTranslation();
    const ResolvedDrawerNavigationItem = useComponentOverride("Shell.DrawerNavigationItem", DrawerNavigationItem);

    // Indent the entries only when the group itself is carrying the icon. Without a
    // header there is nothing to indent under, and collapsed to a rail the entry
    // icons are the only affordance left, so both cases keep the original rows.
    const groupIcon = !hideHeader && drawerOpen ? getIcon(icon, undefined, undefined, "small") : undefined;
    const indentEntries = Boolean(groupIcon);
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
                            "text-surface-500 dark:text-surface-400 transition-transform duration-200 mr-1",
                            collapsed ? "-rotate-90" : "rotate-0"
                        )}
                    />
                    {groupIcon && (
                        <span className="shrink-0 mr-2 flex items-center text-surface-600 dark:text-surface-300 [&>svg]:size-4">
                            {groupIcon}
                        </span>
                    )}
                    <Typography
                        variant={"caption"}
                        color={"secondary"}
                        // A category label is the thing you scan to find anything else in
                        // the drawer, so it is read far more often than it is read *past*.
                        // At 11px uppercase in surface-400 it sat below the contrast of the
                        // rows it labels, which inverted that.
                        className="font-semibold text-[12px] uppercase tracking-wide flex-grow line-clamp-1 text-surface-600 dark:text-surface-300"
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
                        indented={indentEntries}
                    />
                ))}
            </div>
        </div>
    );
}
