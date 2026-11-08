import React, { useCallback } from "react";
import { cls, useElementWidth } from "@rebasepro/ui";
import { CollectionViewLayoutContext, LARGE_COLLECTION_WIDTH } from "./useCollectionLargeLayout";

/**
 * The collection view's own box: the container its `@container` classes and
 * `useCollectionLargeLayout` measure.
 *
 * Its own component, so a resize redraws this box and the parts whose layout
 * flips at the breakpoint — not the whole view on every pixel.
 */
export function CollectionViewFrame({
    className,
    containerRef,
    children
}: {
    className?: string;
    containerRef: React.RefObject<HTMLDivElement | null>;
    children: React.ReactNode;
}) {
    const [measureRef, width] = useElementWidth<HTMLDivElement>();
    const ref = useCallback((element: HTMLDivElement | null) => {
        containerRef.current = element;
        measureRef(element);
    }, [containerRef, measureRef]);
    // Unmeasured — not laid out, or no ResizeObserver — is not "narrow".
    const large = width > 0 ? width >= LARGE_COLLECTION_WIDTH : undefined;

    return (
        <div className={cls("@container/collection overflow-hidden h-full w-full rounded-md flex flex-col bg-surface-sheet", className)}
            ref={ref}>
            <CollectionViewLayoutContext.Provider value={large}>
                {children}
            </CollectionViewLayoutContext.Provider>
        </div>
    );
}
