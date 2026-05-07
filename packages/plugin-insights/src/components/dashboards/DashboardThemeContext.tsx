import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DashboardTheme } from "../../types";
import { loadThemeFonts } from "../../utils/fontLoader";

const DashboardThemeContext = createContext<DashboardTheme>({});

export function useDashboardTheme(): DashboardTheme {
    return useContext(DashboardThemeContext);
}

/**
 * Imperatively switch the whole-app CSS dark mode.
 * Mirrors `useBuildModeController.setDocumentMode`.
 */
export function applyDocumentMode(mode: "light" | "dark") {
    const isDark = mode === "dark";
    document.documentElement.classList.toggle("dark", isDark);
    document.body.classList.toggle("dark", isDark);
    document.body.style.colorScheme = mode;
    document.documentElement.dataset.theme = mode;
}

/**
 * Detect whether the app is in dark mode by observing the `.dark` class
 * on `<html>`. Returns a reactive boolean.
 */
export function useIsDarkMode(): boolean {
    const [dark, setDark] = useState(() =>
        typeof document !== "undefined" && document.documentElement.classList.contains("dark")
    );

    useEffect(() => {
        const el = document.documentElement;
        const observer = new MutationObserver(() => {
            setDark(el.classList.contains("dark"));
        });
        observer.observe(el, { attributes: true, attributeFilter: ["class"] });
        return () => observer.disconnect();
    }, []);

    return dark;
}

// ── Light / dark defaults (mirror index.css) ─────────────────────
export const LIGHT_DEFAULTS: Required<Pick<DashboardTheme,
    "bg" | "text" | "widgetBg" | "widgetBorderColor" | "chartTextColor" |
    "chartGridColor" | "scorecardValueColor" | "scorecardLabelColor" |
    "tableHeaderBg" | "tableHeaderColor" | "tableBorderColor"
>> = {
    bg: "#ffffff",
    text: "rgba(0,0,0,0.87)",
    widgetBg: "#ffffff",
    widgetBorderColor: "#E7E7EB",
    chartTextColor: "#333333",
    chartGridColor: "#f0f0f0",
    scorecardValueColor: "rgba(0,0,0,0.87)",
    scorecardLabelColor: "rgba(0,0,0,0.52)",
    tableHeaderBg: "#f8f8fc",
    tableHeaderColor: "rgba(0,0,0,0.87)",
    tableBorderColor: "#E7E7EB",
};

export const DARK_DEFAULTS: typeof LIGHT_DEFAULTS = {
    bg: "#101013",
    text: "#ffffff",
    widgetBg: "#18181c",
    widgetBorderColor: "#292934",
    chartTextColor: "#cccccc",
    chartGridColor: "#222222",
    scorecardValueColor: "#ffffff",
    scorecardLabelColor: "rgba(255,255,255,0.6)",
    tableHeaderBg: "#17171B",
    tableHeaderColor: "#ffffff",
    tableBorderColor: "#292934",
};

/** Get the right defaults for the current mode */
export function getDefaults(isDark: boolean) {
    return isDark ? DARK_DEFAULTS : LIGHT_DEFAULTS;
}

/**
 * Convert a DashboardTheme object into a CSSProperties-compatible record
 * of CSS custom properties. Only user-set values are emitted; undefined
 * fields fall through to the CSS-defined defaults.
 */
export function themeToCSSVars(theme: DashboardTheme): React.CSSProperties {
    const vars: Record<string, string> = {};
    if (!theme) return vars;

    const set = (cssVar: string, value: string | number | boolean | undefined, unit = "") => {
        if (value === undefined || value === null) return;
        vars[cssVar] = typeof value === "number" ? `${value}${unit}` : String(value);
    };

    // Global
    set("--dataki-bg", theme.bg);
    set("--dataki-text", theme.text);
    set("--dataki-font-family", theme.fontFamily);
    set("--dataki-font-size", theme.fontSize, "px");

    // Widget card
    set("--dataki-widget-bg", theme.widgetBg);
    set("--dataki-widget-border-color", theme.widgetBorderColor);
    set("--dataki-widget-border-width", theme.widgetBorderWidth, "px");
    set("--dataki-widget-border-radius", theme.widgetBorderRadius, "px");
    set("--dataki-widget-shadow", theme.widgetShadow);
    set("--dataki-widget-padding", theme.widgetPadding, "px");

    // Widget title
    set("--dataki-title-font-family", theme.titleFontFamily);
    set("--dataki-title-font-size", theme.titleFontSize, "px");
    set("--dataki-title-font-weight", theme.titleFontWeight);
    set("--dataki-title-color", theme.titleColor);

    // Chart
    set("--dataki-chart-text-color", theme.chartTextColor);
    set("--dataki-chart-grid-color", theme.chartGridColor);
    set("--dataki-chart-font-family", theme.chartFontFamily);
    set("--dataki-chart-bg", theme.chartBg);

    // Chart palette
    if (theme.chartColorPalette) {
        theme.chartColorPalette.forEach((color, i) => {
            set(`--dataki-chart-color-${i + 1}`, color);
        });
    }

    // Scorecard
    set("--dataki-scorecard-value-color", theme.scorecardValueColor);
    set("--dataki-scorecard-label-color", theme.scorecardLabelColor);

    // Table
    set("--dataki-table-header-bg", theme.tableHeaderBg);
    set("--dataki-table-header-color", theme.tableHeaderColor);
    set("--dataki-table-border-color", theme.tableBorderColor);
    set("--dataki-table-stripe-color", theme.tableStripeColor);

    return vars as unknown as React.CSSProperties;
}

/**
 * Wraps children in the theme context and applies CSS custom properties
 * via inline style. Also applies background-color from --dataki-bg
 * so it actually takes effect. Triggers dynamic font loading.
 *
 * When `theme.mode` is set the entire app is pushed into that mode
 * (by toggling the `dark` CSS class on <html>/<body>). The original
 * mode is restored when the provider unmounts or `mode` becomes undefined.
 */
export function DashboardThemeProvider({
    theme,
    children
}: {
    theme?: DashboardTheme;
    children: React.ReactNode;
}) {
    const resolvedTheme = theme ?? {};

    // ── Whole-app mode override ──────────────────────────────────
    // Capture the app's current mode the first time we override it, so we
    // can restore it when the dashboard unmounts or the pin is cleared.
    const savedModeRef = useRef<string | null>(null);

    // Reactive effect: applies the mode whenever it changes.
    // Does NOT restore in cleanup — that avoids the flicker when switching
    // between light and dark (which would otherwise briefly restore system pref).
    useEffect(() => {
        if (!resolvedTheme.mode) {
            // Pin cleared → restore immediately
            if (savedModeRef.current) {
                applyDocumentMode(savedModeRef.current as "light" | "dark");
                savedModeRef.current = null;
            }
            return;
        }

        // Snapshot the pre-override mode once
        if (savedModeRef.current === null) {
            savedModeRef.current = document.documentElement.classList.contains("dark")
                ? "dark"
                : "light";
        }

        applyDocumentMode(resolvedTheme.mode);
    }, [resolvedTheme.mode]);

    // Unmount-only cleanup: restore the original app mode when the provider
    // is torn down (e.g., user navigates away from the dashboard).
    useEffect(() => {
        return () => {
            if (savedModeRef.current) {
                applyDocumentMode(savedModeRef.current as "light" | "dark");
                savedModeRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Load fonts when font fields change
    useEffect(() => {
        loadThemeFonts(resolvedTheme);
    }, [resolvedTheme.fontFamily, resolvedTheme.titleFontFamily, resolvedTheme.chartFontFamily]);

    // Convert theme → inline CSS vars (React diffs this efficiently)
    const style = useMemo(() => {
        return themeToCSSVars(resolvedTheme);
    }, [resolvedTheme]);

    return (
        <DashboardThemeContext.Provider value={resolvedTheme}>
            <div style={style} className="contents">
                {children}
            </div>
        </DashboardThemeContext.Provider>
    );
}
