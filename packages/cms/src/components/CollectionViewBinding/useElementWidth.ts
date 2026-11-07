import React, { useContext, useEffect, useState } from "react";
import { useLargeLayout } from "@rebasepro/app";

/**
 * The rendered width of the element the returned ref is attached to, kept
 * current as it resizes; 0 until it has been measured. A callback ref, so an
 * element that mounts later is measured too.
 */
export function useElementWidth<E extends HTMLElement>(): [(element: E | null) => void, number] {
    const [element, setElement] = useState<E | null>(null);
    const [width, setWidth] = useState(0);
    useEffect(() => {
        if (!element) return;
        setWidth(element.getBoundingClientRect().width);
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
        observer.observe(element);
        return () => observer.disconnect();
    }, [element]);
    return [setElement, width];
}

/**
 * The width at which a collection view lays itself out large: Tailwind's
 * `lg`, and `@5xl` (64rem) for the container classes that follow it.
 */
export const LARGE_COLLECTION_WIDTH = 1024;

/**
 * Whether the collection view a part is drawn in is wide enough for its large
 * layout; `undefined` until it has been measured.
 */
export const CollectionViewLayoutContext = React.createContext<boolean | undefined>(undefined);

/**
 * Whether the collection view this is drawn in is wide enough for its large
 * layout — the frozen id column, labelled toolbar controls, the split side by
 * side. Its own width decides, not the window's: a view in a side panel, a
 * split or a narrow frame is narrow in a wide window. Until the view has been
 * measured, and outside one, the window decides.
 */
export function useCollectionLargeLayout(): boolean {
    const windowLarge = useLargeLayout();
    const large = useContext(CollectionViewLayoutContext);
    return large ?? windowLarge;
}
