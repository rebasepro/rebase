import React, { useContext, useLayoutEffect, useRef, useState } from "react";

import { CircularProgress, cls, SearchBar } from "@rebasepro/ui";
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

const ToolbarLabelsContext = React.createContext(true);

/**
 * Whether the toolbar this control sits in has room for its controls' labels
 * ("Filters", "Add existing", "Add Tag"), or wants their icon-only forms.
 *
 * Decided by the toolbar's own width, not the window's: a relation tab beside
 * the split list is a narrow toolbar in a wide window, and its labelled
 * controls overflowed the left group and were drawn over the search bar.
 * `true` outside a toolbar.
 */
export function useToolbarLabels(): boolean {
    return useContext(ToolbarLabelsContext);
}

/**
 * Whether `row` — the toolbar's controls at their natural width — fits in
 * `container`. Once it has not, the width the labelled controls needed is kept,
 * and the labels come back only when the container has that much room again:
 * measured on the icon-only row, they would always seem to fit.
 */
function useLabelsFit(
    container: React.RefObject<HTMLDivElement | null>,
    row: React.RefObject<HTMLDivElement | null>
): boolean {
    const [labelled, setLabelled] = useState(true);
    const labelledRef = useRef(true);
    const labelledWidth = useRef<number | undefined>(undefined);

    useLayoutEffect(() => {
        const containerElement = container.current;
        const rowElement = row.current;
        if (!containerElement || !rowElement || typeof ResizeObserver === "undefined") return undefined;

        const measure = () => {
            const available = containerElement.clientWidth;
            let next = labelledRef.current;
            if (labelledRef.current) {
                const needed = rowElement.scrollWidth;
                if (needed > available + 1) {
                    labelledWidth.current = needed;
                    next = false;
                }
            } else if (labelledWidth.current !== undefined && available >= labelledWidth.current) {
                next = true;
            }
            if (next !== labelledRef.current) {
                labelledRef.current = next;
                setLabelled(next);
            }
        };

        // The container for the room there is, the row for what the controls
        // take — a selection count appearing widens the row, not the toolbar.
        const observer = new ResizeObserver(measure);
        observer.observe(containerElement);
        observer.observe(rowElement);
        measure();
        return () => observer.disconnect();
    }, [container, row]);

    return labelled;
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

    const containerRef = useRef<HTMLDivElement>(null);
    const rowRef = useRef<HTMLDivElement>(null);
    const labelled = useLabelsFit(containerRef, rowRef);

    // Split actions into "primary" (add button = last child) and "secondary" (everything else)
    const actionChildren = React.Children.toArray(actions);
    const addButton = actionChildren.length > 0 ? actionChildren[actionChildren.length - 1] : null;
    const secondaryActions = actionChildren.slice(0, -1);

    return (
        <div
            ref={containerRef}
            className={cls("no-scrollbar min-h-[52px] overflow-x-auto bg-surface-sheet flex w-full")}>

            {/* At least as wide as the toolbar, and never narrower than its
                controls: the two groups cannot be squeezed into each other.
                When even the icon-only controls do not fit, the toolbar
                scrolls. */}
            <div
                ref={rowRef}
                className={"px-2 md:px-4 flex flex-row justify-between items-center min-w-full w-max"}>

                <ToolbarLabelsContext.Provider value={labelled}>

                    <div className="flex items-center gap-1 md:mr-4 mr-2">

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

                </ToolbarLabelsContext.Provider>

            </div>

        </div>
    );
}
