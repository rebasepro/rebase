import React, { useCallback, useEffect, useRef } from "react";
import { useLocation } from "react-router";

const scrollsMap: Record<string, number> = {};

/**
 * Restores per-route scroll position on a scrollable container, keyed by
 * router location. Used by the framework's own home page implementations.
 *
 * @internal Not part of the stable public API — exported only because
 * `@rebasepro/cms` and `@rebasepro/studio` reuse it in their home page
 * components. Its behavior (module-level scroll cache, router coupling) is
 * an implementation detail and may change without a major version bump.
 */
export function useRestoreScroll() {

    const location = useLocation();

    const containerRef = useRef<HTMLDivElement>(null);
    const [scroll, setScroll] = React.useState(0);
    const [direction, setDirection] = React.useState<"up" | "down">("down");

    // Use ref to track previous scroll for direction calculation
    // This avoids recreating handleScroll on every scroll
    const prevScrollRef = useRef(0);

    const handleScroll = useCallback(() => {
        if (!containerRef.current || !location.key) return;
        const scrollTop = containerRef.current.scrollTop;
        scrollsMap[location.key] = scrollTop;
        setScroll(scrollTop);
        setDirection(scrollTop > prevScrollRef.current ? "down" : "up");
        prevScrollRef.current = scrollTop;
    }, [location.key]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        container.addEventListener("scroll", handleScroll, { passive: true });

        return () => {
            if (container)
                container.removeEventListener("scroll", handleScroll);
        };
    }, [handleScroll]);

    // Defer scroll restoration to next tick to allow async content to render
    // This is necessary because DefaultHomePage content loads asynchronously
    useEffect(() => {
        const savedScroll = scrollsMap[location.key];
        if (!containerRef.current || !savedScroll) return;

        const timeoutId = setTimeout(() => {
            if (!containerRef.current) return;
            containerRef.current.scrollTo({
                top: savedScroll,
                behavior: "auto"
            });
        }, 0);

        return () => clearTimeout(timeoutId);
    }, [location.key]);

    return {
        containerRef,
        scroll,
        direction
    };
}
