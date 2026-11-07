import { useEffect, useState } from "react";

/**
 * The rendered width of the element the returned ref is attached to, kept
 * current as it resizes. A callback ref, so an element that mounts later —
 * after a loading state — is measured too.
 *
 * It measures the element, never the window, so a layout that switches on it
 * behaves the same in a side panel, a split pane or an embedding frame as it
 * does full screen. The width is 0 until the element has mounted.
 *
 * @example
 * ```tsx
 * const [ref, width] = useElementWidth<HTMLDivElement>();
 * return <div ref={ref}>{width >= 600 ? <TwoColumns/> : <OneColumn/>}</div>;
 * ```
 */
export function useElementWidth<E extends HTMLElement>(): [(element: E | null) => void, number] {
    const [element, setElement] = useState<E | null>(null);
    const [width, setWidth] = useState(0);
    useEffect(() => {
        if (!element) return;
        setWidth(element.getBoundingClientRect().width);
        const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
        observer.observe(element);
        return () => observer.disconnect();
    }, [element]);
    return [setElement, width];
}
