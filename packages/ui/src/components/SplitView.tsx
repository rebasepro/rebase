import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { cls } from "../util";
import { useElementWidth } from "../hooks/useElementWidth";
import { useUiLabels } from "../hooks/UiLabelsContext";
import { ArrowLeftIcon, iconSize } from "../icons";
import { IconButton } from "./IconButton";
import { ResizablePanels } from "./ResizablePanels";
import { Typography } from "./Typography";

/**
 * The narrowest container, in px, that shows a `SplitView`'s master and detail
 * side by side; below it the detail covers the master.
 *
 * A list row (title, a secondary line, a status) and a record form (fields at
 * the kit's large size, label inside the box) each stop reading well under
 * about 360px. Two of those plus the divider and a little slack is 768px: at
 * the switch neither pane starts at its floor, and the divider has room to
 * move.
 */
export const SPLIT_VIEW_MIN_WIDTH = 768;

/** The floor of either pane while they are side by side; see {@link SPLIT_VIEW_MIN_WIDTH}. */
const MIN_PANE_WIDTH = 360;

const DEFAULT_MASTER_PERCENT = 40;

export interface SplitViewProps {
    /** The list, or whatever the detail is chosen from. Stays mounted while the detail covers it. */
    master: React.ReactNode;
    /** What is open. Absent, `null` or `false`, the master has the whole width. */
    detail?: React.ReactNode;
    /**
     * Called by the back button of the narrow layout, where the detail covers
     * the master. Without it there is no back button, and closing the detail
     * is up to the detail itself.
     */
    onBack?: () => void;
    /** What the narrow layout's back bar names, beside the back button. */
    detailTitle?: React.ReactNode;
    /** The back button's accessible name. Defaults to the kit's `back` label ("Back"). */
    backLabel?: string;
    /** The master's starting share of the width, 0–100, while the panes are side by side. The divider moves it from there. */
    defaultMasterPercent?: number;
    /** Called with the master's new share, 0–100, each time the divider moves — to remember it for the next visit, say. */
    onMasterPercentChange?: (percent: number) => void;
    /**
     * The narrowest, in px, the divider may make either pane while they are
     * side by side. Defaults to 360. The layout still switches at
     * {@link SPLIT_VIEW_MIN_WIDTH}.
     */
    minPaneWidth?: number;
    className?: string;
}

/**
 * A master-detail layout that follows the width of its own container, never
 * the window: in a side panel, a split pane or an embedding frame it chooses
 * the same way it does full screen.
 *
 * - At {@link SPLIT_VIEW_MIN_WIDTH} or wider, master and detail sit side by
 *   side, with a divider that drags and moves with the arrow keys.
 * - Narrower, it drills down: with a detail, the detail covers the master
 *   under a back bar; without one, the master shows alone.
 *
 * It fills its parent (`w-full h-full`), so the parent needs a height. The
 * master and the detail stay mounted across the switch, so a list keeps its
 * scroll position and a form its edits when the container resizes.
 *
 * @example
 * ```tsx
 * const [selected, setSelected] = useState<Order | null>(null);
 * <SplitView
 *     master={<OrderList onSelect={setSelected}/>}
 *     detail={selected && <OrderForm order={selected}/>}
 *     detailTitle={selected?.number}
 *     onBack={() => setSelected(null)}/>
 * ```
 */
export function SplitView({
    master,
    detail,
    onBack,
    detailTitle,
    backLabel,
    defaultMasterPercent = DEFAULT_MASTER_PERCENT,
    onMasterPercentChange,
    minPaneWidth = MIN_PANE_WIDTH,
    className
}: SplitViewProps) {
    const labels = useUiLabels();
    const [rootRef, width] = useElementWidth<HTMLDivElement>();
    const [masterPercent, setMasterPercent] = useState(defaultMasterPercent);
    const onMasterPercentChangeRef = useRef(onMasterPercentChange);
    onMasterPercentChangeRef.current = onMasterPercentChange;
    const moveDivider = useCallback((percent: number) => {
        setMasterPercent(percent);
        onMasterPercentChangeRef.current?.(percent);
    }, []);
    const masterRef = useRef<HTMLDivElement>(null);
    const backButtonRef = useRef<HTMLButtonElement>(null);

    // `false` too, so `detail={selected && <Form/>}` reads as no detail.
    const hasDetail = detail !== undefined && detail !== null && detail !== false;
    const narrow = width < SPLIT_VIEW_MIN_WIDTH;
    const covered = narrow && hasDetail;
    const showBackBar = covered && (onBack !== undefined || detailTitle !== undefined);

    // When the detail covers the master, focus that was in the master (the row
    // just chosen) would fall to the page; it goes to the back button instead,
    // the one way out of the drill-down. Before paint, while that focus is
    // still where it was.
    useLayoutEffect(() => {
        if (!covered) return;
        const active = document.activeElement;
        if (active && masterRef.current?.contains(active)) {
            backButtonRef.current?.focus();
        }
    }, [covered]);

    return (
        // `data-layout` lets what is drawn inside style itself for either
        // arrangement (`group-data-[layout=stacked]/…`) without measuring again.
        <div ref={rootRef}
            data-layout={narrow ? "stacked" : "split"}
            className={cls("relative w-full h-full min-w-0 min-h-0", className)}>
            <ResizablePanels
                dividerAriaLabel={labels.resizeList}
                stacked={narrow}
                showSecondPanel={hasDetail}
                panelSizePercent={masterPercent}
                onPanelSizeChange={moveDivider}
                minPanelSizePx={minPaneWidth}
                firstPanel={
                    // Hidden rather than unmounted while covered: out of the tab
                    // order and the accessibility tree, with its scroll kept.
                    <div ref={masterRef} className={cls("flex flex-col h-full min-h-0", covered && "invisible")}>
                        {master}
                    </div>
                }
                secondPanel={
                    // The back bar comes and goes as the first child, so the
                    // detail keeps its place in the tree and is never remounted.
                    <div className="flex flex-col h-full min-h-0">
                        {showBackBar && (
                            <div className="h-[52px] shrink-0 flex items-center gap-2 pl-1.5 pr-2">
                                {onBack && (
                                    <IconButton
                                        ref={backButtonRef}
                                        size="small"
                                        onClick={onBack}
                                        aria-label={backLabel ?? labels.back}>
                                        <ArrowLeftIcon size={iconSize.smallest}/>
                                    </IconButton>
                                )}
                                {detailTitle !== undefined && (
                                    <Typography variant="subtitle2" component="div" className="truncate min-w-0 flex-1">
                                        {detailTitle}
                                    </Typography>
                                )}
                            </div>
                        )}
                        <div className="flex flex-col flex-1 min-h-0">
                            {hasDetail ? detail : null}
                        </div>
                    </div>
                }
            />
        </div>
    );
}
