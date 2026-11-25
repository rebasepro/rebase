import React, { useContext, useLayoutEffect, useRef, useState } from "react";

import { CircularProgress, cls, defaultBorderMixin, SearchBar } from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";
import { useCollectionLargeLayout } from "../../CollectionViewBinding/useCollectionLargeLayout";

export interface CollectionTableToolbarProps {
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
 * controls overflowed the left group and were drawn over the search bar. And
 * by the collection view's: a view narrower than its large layout draws its
 * controls icon-only, as a phone does. `true` outside a toolbar.
 */
export function useToolbarLabels(): boolean {
    return useContext(ToolbarLabelsContext);
}

const ToolbarTrailingSlotContext = React.createContext<HTMLElement | null>(null);

/**
 * The element at the trailing edge of the toolbar this control sits in, which
 * stays put while the rest of the toolbar scrolls. `CollectionAddButton`
 * renders itself there, so adding a record is always one click away however
 * narrow the toolbar is. `null` outside a toolbar.
 */
export function useToolbarTrailingSlot(): HTMLElement | null {
    return useContext(ToolbarTrailingSlotContext);
}

/**
 * Whether `row` — the toolbar's controls at their natural width — and the
 * pinned `trailing` slot beside it fit in `container`. Once they have not, the
 * width the labelled controls needed is kept, and the labels come back only
 * when the container has that much room again: measured on the icon-only row,
 * they would always seem to fit.
 *
 * Measured against the whole toolbar, not the scrolling part: the add button in
 * the trailing slot changes width with its label, so the scroller's own width
 * moves with the decision, and comparing against it flipped the labels back
 * and forth.
 */
function useLabelsFit(
    container: React.RefObject<HTMLDivElement | null>,
    row: React.RefObject<HTMLDivElement | null>,
    trailing: HTMLElement | null
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
                const needed = rowElement.scrollWidth + (trailing?.offsetWidth ?? 0);
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
        if (trailing) observer.observe(trailing);
        measure();
        return () => observer.disconnect();
    }, [container, row, trailing]);

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

    const largeLayout = useCollectionLargeLayout();
    const { t } = useTranslation();

    const containerRef = useRef<HTMLDivElement>(null);
    const rowRef = useRef<HTMLDivElement>(null);
    // State, not a ref: the add button portals into it, so it has to re-render
    // once the element exists.
    const [trailingSlot, setTrailingSlot] = useState<HTMLDivElement | null>(null);
    const labelled = useLabelsFit(containerRef, rowRef, trailingSlot);
    const showLabels = labelled && largeLayout;

    // Split actions into "primary" (add button = last child) and "secondary" (everything else)
    const actionChildren = React.Children.toArray(actions);
    const addButton = actionChildren.length > 0 ? actionChildren[actionChildren.length - 1] : null;
    const secondaryActions = actionChildren.slice(0, -1);

    // Where the toolbar has no room for labels, the search bar rests as an
    // icon and widens in place when it is clicked.
    const searchControl = !compact && onTextSearch &&
        <SearchBar
            key={"search-bar"}
            size={"small"}
            placeholder={t("search")}
            onTextSearch={onTextSearch}
            expandable={true}
            collapsible={!showLabels}
            initialValue={initialSearchText}/>;

    return (
        <div
            ref={containerRef}
            className={cls("min-h-[44px] bg-surface-sheet border-b flex w-full items-stretch", defaultBorderMixin)}>

            <ToolbarLabelsContext.Provider value={showLabels}>
                <ToolbarTrailingSlotContext.Provider value={trailingSlot}>

                    {/* Everything but the add button. When even the icon-only
                        controls do not fit, this part scrolls; the trailing
                        slot beside it does not. */}
                    <div className="no-scrollbar overflow-x-auto flex flex-1 min-w-0">

                        {/* At least as wide as the scroller, and never narrower
                            than its controls: the two groups cannot be squeezed
                            into each other. */}
                        <div
                            ref={rowRef}
                            className={"pl-2 @3xl/collection:pl-4 flex flex-row justify-between items-center min-w-full w-max"}>

                            {/* Takes the free space, which the preset chips in
                                `actionsStart` grow into — and never narrower
                                than its controls, or they would be drawn over
                                the search beside them instead of scrolling.
                                (The chips count only as their folded form.) */}
                            <div className="flex flex-1 min-w-max items-center gap-1 @3xl/collection:mr-4 mr-2">

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

                                {searchControl}

                                {/* Secondary actions — always inline */}
                                <div className="flex items-center gap-1">
                                    {secondaryActions}
                                </div>

                                {/* The last action. When it is a
                                    `CollectionAddButton`, the button itself
                                    renders into the trailing slot. */}
                                {addButton}

                            </div>

                        </div>

                    </div>

                    {/* Pinned to the trailing edge. Empty when there is no add
                        button, and then only the padding the row would have had. */}
                    <div
                        ref={setTrailingSlot}
                        className={"flex items-center gap-1 shrink-0 pl-1 pr-2 @3xl/collection:pr-4 empty:pr-1 @3xl/collection:empty:pr-3"}/>

                </ToolbarTrailingSlotContext.Provider>
            </ToolbarLabelsContext.Provider>

        </div>
    );
}
