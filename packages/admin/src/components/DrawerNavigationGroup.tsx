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
     * It decorates the header and nothing else: the entries below are untouched and
     * keep their own icons. An app that wants the categorised look — rows giving up
     * their icons to indent under the group — builds it in its own drawer, by
     * overriding `Shell.DrawerNavigationItem` and passing `indented`.
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
    headerActions,
    onItemClick,
    hideHeader,
    icon
}: DrawerNavigationGroupProps) {
    const { t } = useTranslation();
    const ResolvedDrawerNavigationItem = useComponentOverride("Shell.DrawerNavigationItem", DrawerNavigationItem);

    // The icon decorates the header, and stops there. It used to also strip the
    // entries of theirs and indent them, which made a per-app styling choice into
    // framework behaviour: every project that labelled a group with an icon lost the
    // icons on its rows, with nothing to turn it off. An app that wants that look
    // now opts into it in its own drawer — see `indented` on
    // {@link DrawerNavigationItem}.
    const groupIcon = !hideHeader && drawerOpen ? getIcon(icon, undefined, undefined, "small") : undefined;
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
                    {groupIcon && (
                        <span className="shrink-0 mr-2 flex items-center text-surface-600 dark:text-surface-300 [&>svg]:size-4">
                            {groupIcon}
                        </span>
                    )}
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
