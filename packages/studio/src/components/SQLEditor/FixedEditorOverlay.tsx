import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TextareaAutosize } from "@rebasepro/ui";

/**
 * The box a result cell is edited in. It closes once: Enter saves, Escape
 * cancels, a click away saves — and the blur a closing box can still receive
 * is not a second answer, which made Enter save twice and Escape save at all.
 */
export const FixedEditorOverlay = ({
    displayValue,
    onSave,
    onCancel
}: {
    displayValue: string,
    /** What the box holds when it closes — the text as typed. */
    onSave: (val: string) => void,
    onCancel: () => void
}) => {
    const [rect, setRect] = useState<DOMRect | null>(null);
    const [windowSize, setWindowSize] = useState({ width: 1000,
height: 1000 });
    const anchorRef = useRef<HTMLDivElement>(null);
    const closedRef = useRef(false);
    /** Close the box, saving `typed` when it is given. Only the first call counts. */
    const close = (typed?: string) => {
        if (closedRef.current) return;
        closedRef.current = true;
        if (typed !== undefined) onSave(typed);
        onCancel();
    };

    useEffect(() => {
        if (anchorRef.current && anchorRef.current.parentElement) {
            setRect(anchorRef.current.parentElement.getBoundingClientRect());
        }
        if (typeof window !== "undefined") {
            setWindowSize({ width: window.innerWidth,
height: window.innerHeight });
            const handleResize = () => setWindowSize({ width: window.innerWidth,
height: window.innerHeight });
            window.addEventListener("resize", handleResize);
            return () => window.removeEventListener("resize", handleResize);
        }
        return undefined;
    }, []);

    if (!rect) {
        return <div ref={anchorRef} className="w-full h-full min-h-[20px]" />;
    }

    let top = rect.top - 2;
    let left = rect.left - 2;
    const minWidth = Math.max(rect.width + 4, 250);
    const minHeight = rect.height + 4;

    if (left + minWidth > windowSize.width) {
        left = Math.max(10, windowSize.width - minWidth - 10);
    }

    // Calculate a max height that doesn't overflow the bottom
    const maxAvailableHeight = Math.max(50, windowSize.height - top - 10);
    const resolvedMaxHeight = Math.min(300, maxAvailableHeight);

    // If even the min height overflows, adjust top
    if (top + minHeight > windowSize.height) {
        top = Math.max(10, windowSize.height - minHeight - 10);
    }

    return (
        <div ref={anchorRef} className="w-full h-full min-h-[20px]">
            {createPortal(
                <div
                    className="fixed z-[9999] bg-surface-sheet border-2 border-primary dark:border-primary-dark shadow-xl flex flex-col"
                    style={{
                        top,
                        left,
                        minWidth,
                        minHeight,
                        maxWidth: Math.min(400, windowSize.width - left - 10)
                    }}
                >
                    <TextareaAutosize
                        className="w-full h-full bg-transparent outline-none border-none ring-0 font-mono text-[13px] text-text-primary dark:text-text-primary-dark px-4 py-1.5 resize-none overflow-y-auto"
                        defaultValue={displayValue}
                        autoFocus
                        style={{ minHeight: "32px",
maxHeight: resolvedMaxHeight }}
                        onFocus={(e) => {
                            const val = e.target.value;
                            e.target.value = "";
                            e.target.value = val;
                        }}
                        onBlur={(e) => close(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                close(e.currentTarget.value);
                            }
                            if (e.key === "Escape") close();
                        }}
                    />
                </div>,
                document.body
            )}
        </div>
    );
};
