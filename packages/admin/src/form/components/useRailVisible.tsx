import React, { useEffect, useState } from "react";

/**
 * Below this the form is a single column and the rail is not shown.
 * Roughly: the 780px content column, the 288px rail, and gutters.
 */
export const RAIL_MIN_WIDTH = 1100;

/**
 * Is there room beside the form for the metadata rail?
 *
 * Measured on the form element rather than the viewport, because the same form
 * renders in a side panel and a dialog inside a wide window — a media query
 * would say "desktop" and hand a 600px panel a rail it cannot fit.
 *
 * This has to be a real measurement rather than a CSS `hidden` class: the
 * layout resolver *moves* fields into the rail, so hiding it with CSS did not
 * fold them back into the column, it made them unreachable. Status, category
 * and any other rail field simply could not be edited in the side panel, the
 * dialog, or on a phone.
 */
export function useRailVisible(ref: React.RefObject<HTMLElement | null>): boolean {

    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const element = ref.current;
        if (!element) return;

        const measure = () => setVisible(element.getBoundingClientRect().width >= RAIL_MIN_WIDTH);
        measure();

        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref]);

    return visible;
}
