import { useSyncExternalStore } from "react";

const breakpoints = {
    xs: 0,
    sm: 640,
    md: 768,
    lg: 1024,
    xl: 1280,
    "2xl": 1536,
    "3xl": 1920
}

/**
 * Who is reading the layout, and what it was at the last `resize`.
 *
 * One `resize` listener on `window` serves every reader. It is added when the
 * first reader mounts and removed when the last one unmounts — never by
 * importing this module, which an app can do without rendering anything.
 */
const subscribers = new Set<() => void>();
let lastKnown: boolean | undefined;

function onResize() {
    const next = checkLargeLayout("lg");
    if (next === lastKnown) return;
    lastKnown = next;
    subscribers.forEach(notify => notify());
}

function subscribe(notify: () => void): () => void {
    if (subscribers.size === 0 && typeof window !== "undefined") {
        lastKnown = checkLargeLayout("lg");
        window.addEventListener("resize", onResize);
    }
    subscribers.add(notify);
    return () => {
        subscribers.delete(notify);
        if (subscribers.size === 0 && typeof window !== "undefined") {
            window.removeEventListener("resize", onResize);
            lastKnown = undefined;
        }
    };
}

function getSnapshot(): boolean {
    // While listened to, the value the listener keeps; before the first
    // reader subscribes, the layout as it is now.
    return lastKnown ?? checkLargeLayout("lg");
}

function getServerSnapshot(): boolean {
    return false;
}

export const useLargeLayout = (): boolean =>
    useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

function checkLargeLayout(breakpoint: "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" = "lg"): boolean {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function")
        return false;
    return window.matchMedia(`(min-width: ${breakpoints[breakpoint] + 1}px)`).matches;
}
