import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cls } from "@rebasepro/ui";

type ResizablePanelLayoutProps = {
    children: React.ReactNode; // Main content
    sidePanel: React.ReactNode; // Side panel content (Right or Bottom)
    isPanelOpen: boolean;
    panelSizePercent: number; // 0-100 (width or height)
    onPanelSizeChange: (sizePercent: number) => void;
    onPanelClose?: () => void;
    minPanelSizePx?: number;
    orientation?: 'horizontal' | 'vertical';
};

export function ResizablePanelLayout({
    children,
    sidePanel,
    isPanelOpen,
    panelSizePercent,
    onPanelSizeChange,
    minPanelSizePx = 300,
    orientation = 'horizontal'
}: ResizablePanelLayoutProps) {

    const parentRef = useRef<HTMLDivElement>(null);
    const sidePanelRef = useRef<HTMLDivElement>(null);

    const isResizingRef = useRef(false);
    const startPosRef = useRef(0);
    const startSizeRef = useRef(0);
    const currentDragSizeRef = useRef(0);

    // Track if we are currently resizing to disable transitions
    const [isResizingPanel, setIsResizingPanel] = useState(false);

    const isHorizontal = orientation === 'horizontal';

    // Calculate target panel size in pixels
    const getTargetPanelSize = useCallback(() => {
        if (!isPanelOpen || !parentRef.current) return 0;
        const rect = parentRef.current.getBoundingClientRect();
        const parentSize = isHorizontal ? rect.width : rect.height;
        const pctSize = (parentSize * panelSizePercent) / 100;
        return Math.max(minPanelSizePx, pctSize);
    }, [isPanelOpen, panelSizePercent, minPanelSizePx, isHorizontal]);

    // Sync layout with state
    const updateLayout = useCallback((overrideSize?: number) => {
        if (!parentRef.current) return;

        const targetSize = overrideSize !== undefined ? overrideSize : getTargetPanelSize();

        if (sidePanelRef.current) {
            if (isHorizontal) {
                sidePanelRef.current.style.width = `${targetSize}px`;
                sidePanelRef.current.style.height = "100%";
                sidePanelRef.current.style.minWidth = targetSize > 0 ? `${minPanelSizePx}px` : "0px";
            } else {
                sidePanelRef.current.style.height = `${targetSize}px`;
                sidePanelRef.current.style.width = "100%";
                sidePanelRef.current.style.minHeight = targetSize > 0 ? `${minPanelSizePx}px` : "0px";
            }
        }

        if (isHorizontal) {
            parentRef.current.style.paddingRight = `${targetSize}px`;
            parentRef.current.style.paddingBottom = "0px";
        } else {
            parentRef.current.style.paddingBottom = `${targetSize}px`;
            parentRef.current.style.paddingRight = "0px";
        }

    }, [getTargetPanelSize, minPanelSizePx, isHorizontal]);

    // Initial update and window resize listener
    useEffect(() => {
        if (!isResizingRef.current) {
            updateLayout();
        }
        const handleResize = () => updateLayout();
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, [updateLayout]);

    // Mouse Drag Handlers
    const handleResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        isResizingRef.current = true;
        setIsResizingPanel(true);

        startPosRef.current = isHorizontal ? e.clientX : e.clientY;

        if (sidePanelRef.current) {
            const rect = sidePanelRef.current.getBoundingClientRect();
            startSizeRef.current = isHorizontal ? rect.width : rect.height;
            currentDragSizeRef.current = startSizeRef.current;
        }

        document.body.style.cursor = isHorizontal ? 'col-resize' : 'row-resize';
        document.body.style.userSelect = 'none';
    }, [isHorizontal]);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizingRef.current) return;

            const currentPos = isHorizontal ? e.clientX : e.clientY;
            // Delta is inverted because panel is on Right/Bottom (dragging left/up increases size)
            const delta = startPosRef.current - currentPos;

            let newSize = startSizeRef.current + delta;

            if (parentRef.current) {
                const rect = parentRef.current.getBoundingClientRect();
                const parentSize = isHorizontal ? rect.width : rect.height;
                const maxSize = parentSize * 0.8;
                newSize = Math.max(minPanelSizePx, Math.min(newSize, maxSize));
            } else {
                newSize = Math.max(minPanelSizePx, newSize);
            }

            currentDragSizeRef.current = newSize;

            // Direct DOM update
            if (sidePanelRef.current) {
                if (isHorizontal) {
                    sidePanelRef.current.style.width = `${newSize}px`;
                } else {
                    sidePanelRef.current.style.height = `${newSize}px`;
                }
            }
            if (parentRef.current) {
                if (isHorizontal) {
                    parentRef.current.style.paddingRight = `${newSize}px`;
                } else {
                    parentRef.current.style.paddingBottom = `${newSize}px`;
                }
            }
        };

        const handleMouseUp = () => {
            if (isResizingRef.current) {
                isResizingRef.current = false;
                setIsResizingPanel(false);
                document.body.style.cursor = "";
                document.body.style.userSelect = "";

                // Save final size
                if (parentRef.current) {
                    const rect = parentRef.current.getBoundingClientRect();
                    const parentSize = isHorizontal ? rect.width : rect.height;
                    if (parentSize > 0) {
                        const finalSize = currentDragSizeRef.current;
                        const newPercent = (finalSize / parentSize) * 100;
                        onPanelSizeChange(newPercent);
                        // Force final layout update
                        updateLayout(finalSize);
                    }
                }
            }
        };

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);

        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
        };
    }, [onPanelSizeChange, updateLayout, minPanelSizePx, isHorizontal]);

    // Restore styles after re-render if dragging
    useLayoutEffect(() => {
        if (isResizingPanel && currentDragSizeRef.current > 0) {
            if (parentRef.current) {
                if (isHorizontal) {
                    parentRef.current.style.paddingRight = `${currentDragSizeRef.current}px`;
                } else {
                    parentRef.current.style.paddingBottom = `${currentDragSizeRef.current}px`;
                }
            }
            if (sidePanelRef.current) {
                if (isHorizontal) {
                    sidePanelRef.current.style.width = `${currentDragSizeRef.current}px`;
                } else {
                    sidePanelRef.current.style.height = `${currentDragSizeRef.current}px`;
                }
            }
        }
    }, [isResizingPanel, isHorizontal]);

    return (
        <div
            ref={parentRef}
            className={cls(
                "relative w-full h-full overflow-hidden",
                isResizingPanel ? "" : "transition-all duration-300 ease-in-out"
            )}
            style={{
                paddingRight: isHorizontal ? "0px" : undefined,
                paddingBottom: !isHorizontal ? "0px" : undefined
            }}
        >
            <div className="w-full h-full">
                {children}
            </div>

            <InternalSidePanel
                ref={sidePanelRef}
                isOpen={isPanelOpen}
                isResizing={isResizingPanel}
                onResizeStart={handleResizeStart}
                orientation={orientation}
            >
                {sidePanel}
            </InternalSidePanel>
        </div>
    );
}

const InternalSidePanel = React.memo(React.forwardRef<HTMLDivElement, {
    children: React.ReactNode;
    isOpen: boolean;
    isResizing: boolean;
    onResizeStart: (e: React.MouseEvent) => void;
    orientation: 'horizontal' | 'vertical';
}>(({ children, isOpen, isResizing, onResizeStart, orientation }, ref) => {

    const isHorizontal = orientation === 'horizontal';

    return (
        <div
            ref={ref}
            className={cls(
                "overflow-hidden flex z-20 absolute",
                isHorizontal ? "flex-row h-full top-0 right-0" : "flex-col w-full bottom-0 left-0",
                isResizing ? "" : "transition-all duration-300 ease-in-out",
                isOpen ? "opacity-100" : "opacity-0"
            )}
            style={{
                // Width/Height handled by JS
            }}
        >
            {/* Resize Handle */}
            <div
                className={cls(
                    "absolute z-30 hover:bg-surface-500/10 active:bg-surface-500/2 transition-colors flex items-center justify-center group",
                    isHorizontal ? "left-0 top-0 bottom-0 w-2.5 cursor-col-resize" : "top-0 left-0 right-0 h-2.5 cursor-row-resize",
                    { hidden: !isOpen }
                )}
                onMouseDown={onResizeStart}
            >
                <div className={cls(
                    "bg-slate-300 dark:bg-slate-600 rounded-full opacity-0 group-hover:opacity-100 transition-opacity",
                    isHorizontal ? "h-8 w-2" : "w-8 h-2"
                )} />
            </div>

            <div className={cls(
                "w-full h-full",
                isHorizontal ? "" : ""
            )}>
                {children}
            </div>
        </div>
    );
}));
InternalSidePanel.displayName = "InternalSidePanel";
