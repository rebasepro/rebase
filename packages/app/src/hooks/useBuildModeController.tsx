import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ModeController } from "./useModeController";
import { readStoredString, removeStoredString, writeStoredString } from "../util/local_storage";

const STORAGE_KEY = "prefers-dark-mode";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * @group Hooks and utilities
 */
export interface BuildModeControllerOptions {
    /**
     * `false` builds a controller that touches nothing outside React: no `dark`
     * class on `<html>`, no `prefers-color-scheme` listener, no localStorage.
     * `<Rebase>` passes it when the host app hands over its own
     * `modeController`. Defaults to `true`.
     */
    enabled?: boolean;
}

function systemPrefersDark(): boolean {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(DARK_QUERY).matches;
}

/** The stored choice, or the system's when none is stored. */
function preferredMode(): "light" | "dark" {
    const stored = readStoredString(STORAGE_KEY);
    const prefersDark = stored != null ? stored === "true" : systemPrefersDark();
    return prefersDark ? "dark" : "light";
}

/**
 * Use this hook to build a color mode controller that determines
 * the theme of the admin.
 *
 * While enabled it owns the page's theme: it puts the `dark` class on
 * `document.documentElement`, follows `prefers-color-scheme` until the user
 * picks a mode, and remembers that pick in localStorage. When the component
 * using it unmounts, it takes away the `dark` class if it was the one that
 * added it.
 *
 * @group Hooks and utilities
 */
export function useBuildModeController(options: BuildModeControllerOptions = {}): ModeController {
    const enabled = options.enabled !== false;

    const [mode, setMode] = useState<"light" | "dark">(() => enabled ? preferredMode() : "light");

    // Whether the `dark` class on <html> is one this controller put there. A
    // class the page had before is the page's, and stays when this goes.
    const addedDarkClass = useRef(false);
    const applyToDocument = useCallback((next: "light" | "dark") => {
        const classList = document.documentElement.classList;
        if (next === "dark") {
            if (!classList.contains("dark")) {
                classList.add("dark");
                addedDarkClass.current = true;
            }
        } else {
            classList.remove("dark");
            addedDarkClass.current = false;
        }
    }, []);

    useEffect(() => {
        if (!enabled) return;
        const initial = preferredMode();
        setMode(initial);
        applyToDocument(initial);

        const mediaQuery = typeof window.matchMedia === "function" ? window.matchMedia(DARK_QUERY) : undefined;
        const handleChange = (e: MediaQueryListEvent) => {
            if (readStoredString(STORAGE_KEY) == null) {
                const next = e.matches ? "dark" : "light";
                setMode(next);
                applyToDocument(next);
            }
        };
        mediaQuery?.addEventListener("change", handleChange);
        return () => {
            mediaQuery?.removeEventListener("change", handleChange);
            if (addedDarkClass.current) {
                document.documentElement.classList.remove("dark");
                addedDarkClass.current = false;
            }
        };
    }, [enabled, applyToDocument]);

    const setModeInternal = useCallback((next: "light" | "dark" | "system") => {
        const resolved = next === "system" ? (enabled ? (systemPrefersDark() ? "dark" : "light") : "light") : next;
        if (enabled) {
            applyToDocument(resolved);
            if (next === "system") removeStoredString(STORAGE_KEY);
            else writeStoredString(STORAGE_KEY, next === "dark" ? "true" : "false");
        }
        setMode(resolved);
    }, [enabled, applyToDocument]);

    return useMemo(() => ({
        mode,
        setMode: setModeInternal
    }), [mode, setModeInternal]);
}
