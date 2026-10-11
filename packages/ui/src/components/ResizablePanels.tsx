import React, { useCallback, useEffect, useRef, useState } from "react";
import { cls } from "../util";
import { defaultBorderMixin } from "../styles";

export type ResizablePanelsProps = {
    firstPanel: React.ReactNode;
    secondPanel: React.ReactNode;
    /** Whether the first panel is visible (e.g. Sidebar) */
    showFirstPanel?: boolean;
    /** Whether the second panel is visible (e.g. Results) */
    showSecondPanel?: boolean;
    /** 0-100 representing the width/height of the first panel */
    panelSizePercent: number;
    onPanelSizeChange: (sizePercent: number) => void;
    minPanelSizePx?: number;
    orientation?: "horizontal" | "vertical";
    animateLayout?: boolean;
    className?: string;
    stacked?: boolean;
    /** Accessible name of the divider, e.g. "Resize the list". */
    dividerAriaLabel?: string;
};

/** How far an arrow key moves the divider, in percent; Shift moves it further. */
const KEY_STEP = 2;
const KEY_STEP_LARGE = 10;

export function ResizablePanels({
    firstPanel,
    secondPanel,
    showFirstPanel = true,
    showSecondPanel = true,
    panelSizePercent,
    onPanelSizeChange,
    minPanelSizePx = 200,
    orientation = "horizontal",
    animateLayout = true,
    className,
    stacked = false,
    dividerAriaLabel
}: ResizablePanelsProps) {

    const containerRef = useRef<HTMLDivElement>(null);
    const isResizingRef = useRef(false);

    // For local layout tracking without triggering React rerenders during drag
    const firstPanelRef = useRef<HTMLDivElement>(null);
    const startPosRef = useRef(0);
    const startSizeRef = useRef(0);

    const [isResizing, setIsResizing] = useState(false);
    const isHorizontal = orientation === "horizontal";

    // Pointer events, not mouse events: a mouse-only handle could not be
    // dragged on a tablet.
    const handleResizeStart = useCallback((e: React.PointerEvent) => {
        if (!showFirstPanel || !showSecondPanel) return;

        e.preventDefault();
        isResizingRef.current = true;
        setIsResizing(true);

        startPosRef.current = isHorizontal ? e.clientX : e.clientY;

        if (firstPanelRef.current) {
            const rect = firstPanelRef.current.getBoundingClientRect();
            startSizeRef.current = isHorizontal ? rect.width : rect.height;
        }

        document.body.style.cursor = isHorizontal ? "col-resize" : "row-resize";
        document.body.style.userSelect = "none";
    }, [isHorizontal, showFirstPanel, showSecondPanel]);

    useEffect(() => {
        const handleMouseMove = (e: PointerEvent) => {
            if (!isResizingRef.current || !containerRef.current) return;

            const currentPos = isHorizontal ? e.clientX : e.clientY;
            const delta = currentPos - startPosRef.current; // Dragging right/down increases first panel size

            let newSize = startSizeRef.current + delta;

            const containerRect = containerRef.current.getBoundingClientRect();
            const containerTotal = isHorizontal ? containerRect.width : containerRect.height;

            // Limit the maximum size to prevent pushing the second panel offscreen
            const maxSize = containerTotal - minPanelSizePx;

            newSize = Math.max(minPanelSizePx, Math.min(newSize, maxSize));

            // Directly update the DOM for performance while dragging
            if (firstPanelRef.current) {
                firstPanelRef.current.style.flexBasis = `${newSize}px`;
            }
        };

        const handleMouseUp = () => {
            if (isResizingRef.current && containerRef.current && firstPanelRef.current) {
                // Calculate the final percentage
                const containerRect = containerRef.current.getBoundingClientRect();
                const firstPanelRect = firstPanelRef.current.getBoundingClientRect();

                const containerSize = isHorizontal ? containerRect.width : containerRect.height;
                const finalSize = isHorizontal ? firstPanelRect.width : firstPanelRect.height;

                // Pre-set the DOM to the exact % value BEFORE re-enabling transitions.
                // This prevents the visual "snap" that occurs when switching from px → %
                // with the CSS transition active.
                if (containerSize > 0) {
                    const newPercent = (finalSize / containerSize) * 100;
                    firstPanelRef.current.style.flexBasis = `${newPercent}%`;
                    onPanelSizeChange(Math.max(0, Math.min(100, newPercent)));
                }

                isResizingRef.current = false;
                setIsResizing(false);
                document.body.style.cursor = "";
                document.body.style.userSelect = "";
            }
        };

        window.addEventListener("pointermove", handleMouseMove);
        window.addEventListener("pointerup", handleMouseUp);
        window.addEventListener("pointercancel", handleMouseUp);

        return () => {
            window.removeEventListener("pointermove", handleMouseMove);
            window.removeEventListener("pointerup", handleMouseUp);
            window.removeEventListener("pointercancel", handleMouseUp);
        };
    }, [onPanelSizeChange, isHorizontal, minPanelSizePx]);

    // The arrow keys move the divider by a step, within the same bounds a drag has.
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        const back = isHorizontal ? "ArrowLeft" : "ArrowUp";
        const forward = isHorizontal ? "ArrowRight" : "ArrowDown";
        if (e.key !== back && e.key !== forward) return;
        e.preventDefault();
        const step = (e.shiftKey ? KEY_STEP_LARGE : KEY_STEP) * (e.key === forward ? 1 : -1);
        let min = 0;
        let max = 100;
        const container = containerRef.current?.getBoundingClientRect();
        const total = container ? (isHorizontal ? container.width : container.height) : 0;
        if (total > 0) {
            min = Math.min(50, (minPanelSizePx / total) * 100);
            max = Math.max(50, 100 - (minPanelSizePx / total) * 100);
        }
        onPanelSizeChange(Math.max(min, Math.min(max, panelSizePercent + step)));
    }, [isHorizontal, minPanelSizePx, onPanelSizeChange, panelSizePercent]);

    // Calculate applied size
    const appliedBasis = !showFirstPanel ? "0%" : (showSecondPanel ? `${panelSizePercent}%` : "100%");

    return (
        <div
            ref={containerRef}
            className={cls(
                "relative w-full h-full flex overflow-hidden",
                !stacked && (isHorizontal ? "flex-row" : "flex-col"),
                className
            )}
        >
            {/* First Panel */}
            <div
                ref={firstPanelRef}
                className={cls(
                    stacked ? "absolute inset-0" : "relative flex-shrink-0",
                    "flex flex-col overflow-hidden",
                    !stacked && !isResizing && animateLayout && "transition-[flex-basis] duration-150 ease-out",
                    !showFirstPanel && "hidden"
                )}
                style={stacked ? undefined : {
                    flexBasis: appliedBasis,
                    minWidth: isHorizontal && showFirstPanel && showSecondPanel ? `${minPanelSizePx}px` : undefined,
                    minHeight: !isHorizontal && showFirstPanel && showSecondPanel ? `${minPanelSizePx}px` : undefined,
                    maxWidth: showSecondPanel ? undefined : "100%",
                    maxHeight: showSecondPanel ? undefined : "100%"
                }}
            >
                {firstPanel}
            </div>

            {/* Divider */}
            {!stacked && showFirstPanel && showSecondPanel && (
                <div
                    // The divider is a handle, not a rule: invisible until the
                    // pointer is on it. The two panels it separates already
                    // differ by a surface step, and a permanent 1px line between
                    // them was one of six on the split record view where the
                    // reference draws one.
                    role="separator"
                    tabIndex={0}
                    aria-label={dividerAriaLabel}
                    // The line between side-by-side panels is vertical.
                    aria-orientation={isHorizontal ? "vertical" : "horizontal"}
                    aria-valuenow={Math.round(panelSizePercent)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className={cls(
                        "relative z-10 flex flex-shrink-0 items-center justify-center border-transparent touch-none group/divider",
                        isHorizontal ? "border-l w-px h-full cursor-col-resize" : "border-t h-px w-full cursor-row-resize"
                    )}
                    onPointerDown={handleResizeStart}
                    onKeyDown={handleKeyDown}
                >
                    {/* Transparent Hit Area with Pill inside */}
                    <div className={cls(
                        "absolute flex items-center justify-center group",
                        isHorizontal ? "w-4 h-full cursor-col-resize top-0" : "h-4 w-full cursor-row-resize left-0"
                    )}>
                        <div className={cls(
                            "bg-primary/60 dark:bg-primary rounded-full opacity-0 group-hover:opacity-100 group-focus-visible/divider:opacity-100 transition-all duration-200",
                            isHorizontal ? "w-1 h-8" : "h-1 w-8"
                        )}/>
                    </div>
                </div>
            )}

            {/* Second Panel */}
            <div
                className={cls(
                    stacked ? "absolute inset-0" : "flex-grow relative min-w-0 min-h-0",
                    "flex flex-col overflow-hidden",
                    !showSecondPanel && "hidden"
                )}
            >
                {secondPanel}
            </div>
        </div>
    );
}
