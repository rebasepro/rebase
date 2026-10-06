import { useSyncExternalStore } from "react";

/**
 * Whether the document is in dark mode right now, and re-rendered when that
 * changes.
 *
 * The theme is a class on `<html>` (`dark`, set by the panel's mode
 * controller) or a `data-theme` attribute (the marketing site). Components
 * that pick colours in JS rather than through CSS variables — `Chip` derives
 * its ink per theme — used to read the class once at render and never again,
 * so a theme switch left every chip on screen wearing the other theme's ink
 * until something else happened to re-render it. Subscribing through a
 * `MutationObserver` on the root's attributes makes the read live.
 */
export function useIsDarkMode(): boolean {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function getSnapshot(): boolean {
    if (typeof document === "undefined") return false;
    const root = document.documentElement;
    return root.classList.contains("dark") || root.getAttribute("data-theme") === "dark";
}

function getServerSnapshot(): boolean {
    return false;
}

/**
 * Every subscriber shares one observer of `<html>`.
 *
 * `Chip` subscribes, and a table can mount hundreds of chips; an observer per
 * subscriber meant hundreds of observers on one element, rebuilt on every
 * virtualised scroll step. The observer is created with the first subscriber
 * and disconnected with the last. Entries are per subscription, not per
 * callback, so one callback subscribed twice still needs two unsubscribes.
 */
const subscribers = new Set<{ onChange: () => void }>();
let observer: MutationObserver | undefined;

function subscribe(onChange: () => void): () => void {
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => undefined;
    const entry = { onChange };
    subscribers.add(entry);
    if (!observer) {
        observer = new MutationObserver(() => {
            for (const subscriber of [...subscribers]) subscriber.onChange();
        });
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["class", "data-theme"]
        });
    }
    return () => {
        subscribers.delete(entry);
        if (subscribers.size === 0 && observer) {
            observer.disconnect();
            observer = undefined;
        }
    };
}
