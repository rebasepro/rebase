import React, { useEffect, useRef } from "react";

export type ViewScrollEvent = {
    scrollDirection: "forward" | "backward";
    scrollOffset: number;
    scrollUpdateWasRequested: boolean;
};

/**
 * The nearest ancestor that scrolls vertically. The list and card views do not
 * scroll themselves: the page around them does, so that is the element whose
 * offset is worth keeping.
 */
export function getScrollParent(element: HTMLElement | null): HTMLElement | null {
    if (!element) return null;
    let parent = element.parentElement;
    while (parent) {
        const overflowY = window.getComputedStyle(parent).overflowY;
        if (overflowY === "auto" || overflowY === "scroll") {
            return parent;
        }
        parent = parent.parentElement;
    }
    return document.documentElement;
}

/**
 * Report the scroll parent's offset through `onScroll`, and put it back at
 * `initialScroll` once there are rows to scroll over.
 *
 * Opening a record full screen unmounts the collection view, so coming back
 * mounts a fresh one. The caller keeps the offset (and the rows it was over)
 * outside the component; this is what hands it over and applies it again.
 */
export function useScrollParentRestoration({
    containerRef,
    initialScroll,
    onScroll,
    dataLength
}: {
    containerRef: React.RefObject<HTMLElement | null>;
    initialScroll?: number;
    onScroll?: (props: ViewScrollEvent) => void;
    dataLength: number;
}) {
    // The offset this mount started with, and only that one. `initialScroll`
    // goes on changing after mount — callers read it back from the store
    // `onScroll` writes — so following the prop would scroll the view to where
    // it was a moment ago, under a user who is scrolling it.
    const restoreTo = useRef(initialScroll);

    useEffect(() => {
        const target = restoreTo.current;
        if (!containerRef.current || !target || dataLength === 0) return;

        const scrollEl = getScrollParent(containerRef.current);
        if (!scrollEl) return;

        let attempts = 0;
        const maxAttempts = 5;
        let rafId: number | null = null;

        const tryRestore = () => {
            rafId = null;
            if (scrollEl.scrollHeight >= target || attempts >= maxAttempts) {
                scrollEl.scrollTop = target;
                restoreTo.current = undefined;
            } else {
                attempts++;
                rafId = requestAnimationFrame(tryRestore);
            }
        };

        rafId = requestAnimationFrame(tryRestore);
        return () => {
            if (rafId !== null) cancelAnimationFrame(rafId);
        };
    }, [containerRef, dataLength]);

    const lastScrollOffset = useRef(0);
    useEffect(() => {
        const el = containerRef.current;
        if (!el || !onScroll) return;
        const scrollEl = getScrollParent(el);
        if (!scrollEl) return;

        const handleScroll = () => {
            const currentOffset = scrollEl.scrollTop;
            const direction = currentOffset > lastScrollOffset.current ? "forward" : "backward";
            lastScrollOffset.current = currentOffset;
            onScroll({
                scrollDirection: direction,
                scrollOffset: currentOffset,
                scrollUpdateWasRequested: false
            });
        };

        scrollEl.addEventListener("scroll", handleScroll, { passive: true });
        return () => scrollEl.removeEventListener("scroll", handleScroll);
    }, [containerRef, onScroll]);
}
