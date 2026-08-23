import { useCallback, useEffect, useState, useMemo } from "react";

import type { ModeController } from "./useModeController";
import { readStoredString, removeStoredString, writeStoredString } from "../util/local_storage";

/**
 * Use this hook to build a color mode controller that determines
 * the theme of the admin
 */
export function useBuildModeController(): ModeController {

    const prefersDarkModeQuery = useCallback((): boolean => {
        if (typeof window === "undefined")
            return false;
        const mediaQueryList = window.matchMedia("(prefers-color-scheme: dark)");
        return mediaQueryList.matches;
    }, []);

    const [mode, setMode] = useState<"light" | "dark">(() => {
        const storedPrefersDarkMode = readStoredString("prefers-dark-mode");
        const prefersDarkModeStorage = storedPrefersDarkMode != null
            ? storedPrefersDarkMode === "true"
            : null;
        const prefersDarkMode = prefersDarkModeStorage ?? prefersDarkModeQuery();
        return prefersDarkMode ? "dark" : "light";
    });

    useEffect(() => {
        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        const handleChange = (e: MediaQueryListEvent) => {
            if (readStoredString("prefers-dark-mode") == null) {
                setMode(e.matches ? "dark" : "light");
                setDocumentMode(e.matches ? "dark" : "light");
            }
        };

        // Initial setup
        setDocumentMode(mode);

        mediaQuery.addEventListener("change", handleChange);
        return () => mediaQuery.removeEventListener("change", handleChange);
    }, []);

    const setDocumentMode = (mode: "light" | "dark") => {
        if (mode === "dark") {
            document.documentElement.classList.add("dark");
        } else {
            document.documentElement.classList.remove("dark");
        }
    };

    const setModeInternal = useCallback((mode: "light" | "dark" | "system") => {
        if (mode === "light") {
            setDocumentMode("light");
            writeStoredString("prefers-dark-mode", "false");
            setMode("light");
        } else if (mode === "dark") {
            setDocumentMode("dark");
            writeStoredString("prefers-dark-mode", "true");
            setMode("dark");
        } else {
            const preferredMode = prefersDarkModeQuery() ? "dark" : "light";
            setDocumentMode(preferredMode);
            removeStoredString("prefers-dark-mode");
            setMode(preferredMode);
        }
    }, [prefersDarkModeQuery]);

    return useMemo(() => ({
        mode,
        setMode: setModeInternal
    }), [mode, setModeInternal]);
}
