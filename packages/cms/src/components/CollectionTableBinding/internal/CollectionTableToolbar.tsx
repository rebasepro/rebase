import React from "react";

import { CircularProgress, cls, defaultBorderMixin, SearchBar } from "@rebasepro/ui";
import { useLargeLayout, useTranslation } from "@rebasepro/app";

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
     * Initial search string to pre-populate the search bar (e.g. from URL params).
     */
    initialSearchText?: string;
    /**
     * When true the toolbar is in "compact" mode for the split-view left panel.
     * - Search bar, loading spinner, and view-mode toggle are hidden.
     * - Secondary actions remain inline (displayed horizontally).
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
    initialSearchText,
    compact = false
}: CollectionTableToolbarProps) {

    const largeLayout = useLargeLayout();
    const { t } = useTranslation();

    // Split actions into "primary" (add button = last child) and "secondary" (everything else)
    const actionChildren = React.Children.toArray(actions);
    const addButton = actionChildren.length > 0 ? actionChildren[actionChildren.length - 1] : null;
    const secondaryActions = actionChildren.slice(0, -1);

    return (
        <div
            className={cls(defaultBorderMixin, "no-scrollbar min-h-[52px] overflow-x-auto px-2 md:px-4 bg-surface-50 dark:bg-surface-900 border-b flex flex-row justify-between items-center w-full")}>

            <div className="flex items-center gap-1 md:mr-4 mr-2 min-w-0">

                {/* View toggle — hidden in compact */}
                {!compact && viewModeToggle}

                {title && <div className={"flex items-center"}>
                    {title}
                </div>}

                {actionsStart}

            </div>

            <div className="flex items-center gap-1">

                {/* Loading spinner — hidden in compact */}
                {largeLayout && !compact && loading && (
                    <div className="mr-4">
                        <CircularProgress size={"smallest"}/>
                    </div>
                )}

                {/* Search bar — hidden in compact */}
                {!compact && onTextSearch &&
                    <SearchBar
                        key={"search-bar"}
                        size={"small"}
                        placeholder={t("search")}
                        onTextSearch={onTextSearch}
                        expandable={true}
                        initialValue={initialSearchText}/>}

                {/* Secondary actions — always inline */}
                <div className="flex items-center gap-1">
                    {secondaryActions}
                </div>

                {/* Add button — always visible */}
                {addButton}

            </div>

        </div>
    );
}
