import React, { useState } from "react";

import { CircularProgress, cls, defaultBorderMixin, IconButton, Popover, SearchBar , iconSize } from "@rebasepro/ui";
import { MoreVerticalIcon } from "lucide-react";
import { useLargeLayout, useTranslation } from "@rebasepro/core";

interface CollectionTableToolbarProps {
    loading: boolean;
    actionsStart?: React.ReactNode;
    actions?: React.ReactNode;
    /**
     * View mode toggle button, positioned left of the search bar.
     */
    viewModeToggle?: React.ReactNode;
    title?: React.ReactNode,
    onTextSearch?: (searchString?: string) => void;
    /**
     * When true the toolbar is in "compact" mode for the split-view left panel.
     * - Search bar, loading spinner, and view-mode toggle are hidden.
     * - Secondary actions are collapsed into a "⋮" popover.
     * - Only `actionsStart` (filters) and the add button (last child of `actions`) remain visible.
     */
    compact?: boolean;
}

export function CollectionTableToolbar({
    actions,
    actionsStart,
    loading,
    onTextSearch,
    title,
    viewModeToggle,
    compact = false
}: CollectionTableToolbarProps) {

    const largeLayout = useLargeLayout();
    const { t } = useTranslation();
    const [overflowOpen, setOverflowOpen] = useState(false);

    // Split actions into "primary" (add button = last child) and "secondary" (everything else)
    const actionChildren = React.Children.toArray(actions);
    const addButton = actionChildren.length > 0 ? actionChildren[actionChildren.length - 1] : null;
    const secondaryActions = actionChildren.slice(0, -1);

    return (
        <div
            className={cls(defaultBorderMixin, "no-scrollbar min-h-[52px] overflow-x-auto px-2 md:px-4 bg-surface-50 dark:bg-surface-900 border-b flex flex-row justify-between items-center w-full")}>

            <div className="flex items-center gap-1 md:mr-4 mr-2">

                {/* View toggle — hidden in compact */}
                <div className={cls(
                    "transition-all duration-300 ease-out overflow-hidden",
                    compact ? "max-w-0 opacity-0" : "max-w-[200px] opacity-100"
                )}>
                    {viewModeToggle}
                </div>

                {title && <div className={"hidden lg:block"}>
                    {title}
                </div>}

                {actionsStart}

            </div>

            <div className="flex items-center gap-1">

                {/* Loading spinner — hidden in compact */}
                {largeLayout && <div className={cls(
                    "mr-4 transition-all duration-300 ease-out overflow-hidden",
                    compact ? "w-0 opacity-0" : "w-[22px] opacity-100"
                )}>
                    {loading &&
                        <CircularProgress size={"smallest"}/>}
                </div>}

                {/* Search bar — hidden in compact */}
                <div className={cls(
                    "transition-all duration-300 ease-out",
                    compact ? "max-w-0 opacity-0 overflow-hidden" : "max-w-[300px] opacity-100"
                )}>
                    {onTextSearch &&
                        <SearchBar
                            key={"search-bar"}
                            size={"small"}
                            placeholder={t("search")}
                            onTextSearch={onTextSearch}
                            expandable={true}/>}
                </div>

                {/* Secondary actions — visible normally, collapsed to popover in compact */}
                <div className={cls(
                    "flex items-center gap-1 transition-all duration-300 ease-out overflow-hidden",
                    compact ? "max-w-0 opacity-0 pointer-events-none" : "max-w-[600px] opacity-100"
                )}>
                    {secondaryActions}
                </div>

                {/* Overflow popover — only visible in compact mode */}
                {secondaryActions.length > 0 && (
                    <div className={cls(
                        "transition-all duration-300 ease-out overflow-hidden",
                        compact ? "max-w-[40px] opacity-100" : "max-w-0 opacity-0 pointer-events-none"
                    )}>
                        <Popover
                            open={overflowOpen}
                            onOpenChange={setOverflowOpen}
                            trigger={
                                <IconButton size="small">
                                    <MoreVerticalIcon size={iconSize.small}/>
                                </IconButton>
                            }>
                            <div className="flex flex-col gap-1 p-2 min-w-[200px]">
                                {secondaryActions.map((child, i) => (
                                    <div key={i} className="flex items-center" onClick={() => setOverflowOpen(false)}>
                                        {child}
                                    </div>
                                ))}
                            </div>
                        </Popover>
                    </div>
                )}

                {/* Add button — always visible */}
                {addButton}

            </div>

        </div>
    );
}
