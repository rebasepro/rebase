import { X } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, cls, IconButton, TextField, Tooltip, Typography } from "@rebasepro/ui";
import { Dashboard, DashboardTheme } from "../../types";
import { useDataki } from "../../DatakiProvider";
import { loadGoogleFont } from "../../utils/fontLoader";
import { getDefaults, useIsDarkMode } from "./DashboardThemeContext";

// ── Google Fonts list (popular subset — expandable) ──────────────
// We ship a curated list; the search queries the Google Fonts CSS API at runtime.
const POPULAR_FONTS = [
    "Inter", "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins",
    "Raleway", "Nunito", "Oswald", "Source Sans 3", "Playfair Display",
    "Merriweather", "Outfit", "DM Sans", "Rubik", "Work Sans", "Fira Sans",
    "IBM Plex Sans", "Barlow", "Quicksand", "Manrope", "Sora", "Archivo",
    "Lexend", "Plus Jakarta Sans", "Space Grotesk", "Cabin", "Karla",
    "Libre Baskerville", "Cormorant Garamond", "Crimson Text", "EB Garamond",
    "Spectral", "Bitter", "Josefin Sans", "Noto Sans", "Mulish",
    "Ubuntu", "Titillium Web", "PT Sans", "Varela Round", "Overpass",
    "Assistant", "Sarabun", "Catamaran", "Hind", "Exo 2", "Kanit",
    "Prompt", "Comfortaa", "Rajdhani", "Signika", "Aleo"
];

// ── Built-in preset themes ───────────────────────────────────────
const PRESETS: { name: string; theme: DashboardTheme }[] = [
    { name: "Default", theme: {} },
    {
        name: "Dark",
        theme: {
            mode: "dark" as const,
            bg: "#101013",
            text: "#ffffff",
            widgetBg: "#18181c",
            widgetBorderColor: "#292934",
            widgetShadow: "none",
            chartTextColor: "#ccc",
            chartGridColor: "#222",
            tableHeaderBg: "#17171B",
            tableBorderColor: "#292934",
            scorecardValueColor: "#ffffff",
            scorecardLabelColor: "rgba(255,255,255,0.6)",
            tableHeaderColor: "#ffffff",
        }
    },
    {
        name: "Minimal",
        theme: {
            widgetBorderWidth: 0,
            widgetShadow: "none",
            widgetBorderRadius: 4,
            widgetPadding: 12,
            titleFontWeight: 500,
        }
    },
    {
        name: "Bold",
        theme: {
            fontFamily: "Inter",
            titleFontSize: 16,
            titleFontWeight: 800,
            widgetBorderRadius: 16,
            widgetShadow: "0 4px 16px rgba(0,0,0,0.12)",
            widgetBorderWidth: 0,
            chartColorPalette: ["#6366F1", "#EC4899", "#F59E0B", "#10B981", "#0EA5E9", "#F97316", "#8B5CF6", "#14B8A6", "#EF4444", "#84CC16"],
        }
    },
    {
        name: "Corporate",
        theme: {
            fontFamily: "Roboto",
            titleFontFamily: "Roboto",
            widgetBorderRadius: 4,
            widgetShadow: "0 1px 2px rgba(0,0,0,0.05)",
            chartColorPalette: ["#1E40AF", "#7C3AED", "#059669", "#DC2626", "#D97706", "#2563EB", "#9333EA", "#10B981", "#EF4444", "#F59E0B"],
        }
    }
];

const DEFAULT_PALETTE = [
    "#0070F4", "#FF5B79", "#10B981", "#F59E0B", "#8B5CF6",
    "#EC4899", "#06B6D4", "#F97316", "#14B8A6", "#6366F1"
];

// ── Sub-components ───────────────────────────────────────────────
function ColorSwatch({ color, onChange, label }: {
    color: string;
    onChange: (c: string) => void;
    label: string;
}) {
    return (
        <label className="flex items-center gap-2 cursor-pointer">
            <input
                type="color"
                value={color || "#000000"}
                onChange={(e) => onChange(e.target.value)}
                className="w-7 h-7 rounded-md border border-surface-200 dark:border-surface-700 cursor-pointer p-0"
                style={{ WebkitAppearance: "none", appearance: "none" }}
            />
            <span className="text-xs text-surface-600 dark:text-surface-400">{label}</span>
        </label>
    );
}

function SliderRow({ label, value, onChange, min = 0, max = 32, unit = "px" }: {
    label: string;
    value: number;
    onChange: (v: number) => void;
    min?: number;
    max?: number;
    unit?: string;
}) {
    return (
        <div className="flex items-center gap-3">
            <span className="text-xs text-surface-600 dark:text-surface-400 min-w-[80px]">{label}</span>
            <input
                type="range"
                min={min}
                max={max}
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                className="flex-1 accent-primary h-1"
            />
            <span className="text-xs font-mono w-10 text-right">{value}{unit}</span>
        </div>
    );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
    return (
        <Typography variant="label" className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400 mt-4 mb-2">
            {children}
        </Typography>
    );
}

// ── Font Search Dropdown ─────────────────────────────────────────
function FontSearchField({ label, value, onChange }: {
    label: string;
    value: string;
    onChange: (font: string | undefined) => void;
}) {
    const [query, setQuery] = useState(value ?? "");
    const [isFocused, setIsFocused] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Sync from parent
    useEffect(() => {
        setQuery(value ?? "");
    }, [value]);

    const filteredFonts = useMemo(() => {
        if (!query) return POPULAR_FONTS.slice(0, 15);
        const lower = query.toLowerCase();
        return POPULAR_FONTS.filter(f => f.toLowerCase().includes(lower)).slice(0, 15);
    }, [query]);

    const selectFont = useCallback((font: string) => {
        setQuery(font);
        onChange(font || undefined);
        loadGoogleFont(font);
        setIsFocused(false);
    }, [onChange]);

    // Close dropdown when clicking outside
    useEffect(() => {
        if (!isFocused) return;
        const handler = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsFocused(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [isFocused]);

    return (
        <div ref={containerRef} className="relative">
            <TextField
                size="small"
                label={label}
                placeholder="Search Google Fonts…"
                value={query}
                onChange={(e) => {
                    setQuery(e.target.value);
                    if (!e.target.value) {
                        onChange(undefined);
                    }
                }}
                onFocus={() => setIsFocused(true)}
            />
            {isFocused && filteredFonts.length > 0 && (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {filteredFonts.map(font => (
                        <button
                            key={font}
                            type="button"
                            className={cls(
                                "w-full text-left px-3 py-1.5 text-sm hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors",
                                font === value && "bg-primary/10 text-primary font-medium"
                            )}
                            onMouseDown={(e) => {
                                e.preventDefault(); // prevent blur
                                selectFont(font);
                            }}
                            style={{ fontFamily: font }}
                        >
                            {font}
                        </button>
                    ))}
                    {query && !filteredFonts.some(f => f.toLowerCase() === query.toLowerCase()) && (
                        <button
                            type="button"
                            className="w-full text-left px-3 py-1.5 text-sm text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800 italic"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                selectFont(query);
                            }}
                        >
                            Use "{query}"
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Main component ──────────────────────────────────────────────
export function DashboardThemePanel({
    onClose,
    dashboard,
    onThemeChange,
}: {
    onClose: () => void;
    dashboard: Dashboard;
    onThemeChange?: (theme: DashboardTheme) => void;
}) {
    const datakiConfig = useDataki();
    const isDark = useIsDarkMode();
    const d = getDefaults(isDark);
    const [theme, setTheme] = useState<DashboardTheme>(dashboard.theme ?? {});

    // Sync when dashboard.theme changes externally
    useEffect(() => {
        setTheme(dashboard.theme ?? {});
    }, [dashboard.theme]);

    const update = useCallback((partial: Partial<DashboardTheme>) => {
        setTheme(prev => {
            const next = { ...prev, ...partial };
            onThemeChange?.(next);
            return next;
        });
    }, [onThemeChange]);

    // Auto-save with debounce
    useEffect(() => {
        const timer = setTimeout(() => {
            datakiConfig.updateDashboard(dashboard.id, { theme }, "theme_update");
        }, 400);
        return () => clearTimeout(timer);
    }, [theme, dashboard.id, datakiConfig]);

    // Load font when user changes it
    useEffect(() => {
        if (theme.fontFamily) loadGoogleFont(theme.fontFamily);
        if (theme.titleFontFamily) loadGoogleFont(theme.titleFontFamily);
        if (theme.chartFontFamily) loadGoogleFont(theme.chartFontFamily);
    }, [theme.fontFamily, theme.titleFontFamily, theme.chartFontFamily]);

    const palette = theme.chartColorPalette ?? DEFAULT_PALETTE;

    const applyPreset = useCallback((preset: DashboardTheme) => {
        setTheme(preset);
        onThemeChange?.(preset);
    }, [onThemeChange]);

    return (
        <div className="flex flex-col h-full bg-surface-50 dark:bg-surface-950 rounded-lg border border-surface-200 dark:border-surface-800">

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-surface-200 dark:border-surface-800 flex-shrink-0">
                <Typography variant="subtitle2" className="font-semibold">
                    Dashboard Theme
                </Typography>
                <IconButton size="small" onClick={onClose}>
                    <X size="small" />
                </IconButton>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-4 pb-6">

                {/* ── Appearance mode ── */}
                <SectionHeader>Appearance</SectionHeader>
                <div className="flex rounded-lg overflow-hidden border border-surface-200 dark:border-surface-700 mb-1">
                    {([
                        { label: "System", value: undefined, icon: "⚙️" },
                        { label: "Light",  value: "light" as const, icon: "☀️" },
                        { label: "Dark",   value: "dark"  as const, icon: "🌙" },
                    ] as const).map(({ label, value, icon }) => {
                        const isActive = theme.mode === value;
                        return (
                            <button
                                key={label}
                                type="button"
                                onClick={() => update({ mode: value })}
                                className={cls(
                                    "flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors select-none",
                                    isActive
                                        ? "bg-primary text-white"
                                        : "bg-transparent text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800"
                                )}
                            >
                                <span>{icon}</span>
                                <span>{label}</span>
                            </button>
                        );
                    })}
                </div>

                {/* ── Presets ── */}
                <SectionHeader>Presets</SectionHeader>
                <div className="flex flex-wrap gap-1.5">
                    {PRESETS.map((p) => (
                        <Button
                            key={p.name}
                            size="small"
                            variant="outlined"
                            color="neutral"
                            className="rounded-lg text-xs"
                            onClick={() => applyPreset(p.theme)}
                        >
                            {p.name}
                        </Button>
                    ))}
                </div>

                {/* ── Colors ── */}
                <SectionHeader>Colors</SectionHeader>
                <div className="grid grid-cols-2 gap-2">
                    <ColorSwatch
                        color={theme.bg ?? d.bg}
                        onChange={(c) => update({ bg: c })}
                        label="Background"
                    />
                    <ColorSwatch
                        color={theme.text ?? d.text}
                        onChange={(c) => update({ text: c })}
                        label="Text"
                    />
                    <ColorSwatch
                        color={theme.widgetBg ?? d.widgetBg}
                        onChange={(c) => update({ widgetBg: c })}
                        label="Card"
                    />
                    <ColorSwatch
                        color={theme.widgetBorderColor ?? d.widgetBorderColor}
                        onChange={(c) => update({ widgetBorderColor: c })}
                        label="Card border"
                    />
                </div>

                {/* ── Typography ── */}
                <SectionHeader>Typography</SectionHeader>
                <div className="flex flex-col gap-2">
                    <FontSearchField
                        label="Global font"
                        value={theme.fontFamily ?? ""}
                        onChange={(f) => update({ fontFamily: f })}
                    />
                    <FontSearchField
                        label="Title font"
                        value={theme.titleFontFamily ?? ""}
                        onChange={(f) => update({ titleFontFamily: f })}
                    />
                    <SliderRow
                        label="Base size"
                        value={theme.fontSize ?? 14}
                        onChange={(v) => update({ fontSize: v })}
                        min={10}
                        max={24}
                    />
                    <SliderRow
                        label="Title size"
                        value={theme.titleFontSize ?? 13}
                        onChange={(v) => update({ titleFontSize: v })}
                        min={10}
                        max={28}
                    />
                </div>

                {/* ── Widget Cards ── */}
                <SectionHeader>Widget Cards</SectionHeader>
                <div className="flex flex-col gap-2">
                    <SliderRow
                        label="Radius"
                        value={theme.widgetBorderRadius ?? 12}
                        onChange={(v) => update({ widgetBorderRadius: v })}
                        min={0}
                        max={32}
                    />
                    <SliderRow
                        label="Border"
                        value={theme.widgetBorderWidth ?? 1}
                        onChange={(v) => update({ widgetBorderWidth: v })}
                        min={0}
                        max={4}
                    />
                    <SliderRow
                        label="Padding"
                        value={theme.widgetPadding ?? 16}
                        onChange={(v) => update({ widgetPadding: v })}
                        min={0}
                        max={32}
                    />
                    <TextField
                        size="small"
                        label="Shadow"
                        placeholder="CSS box-shadow"
                        value={theme.widgetShadow ?? ""}
                        onChange={(e) => update({ widgetShadow: e.target.value || undefined })}
                    />
                </div>

                {/* ── Chart Palette ── */}
                <SectionHeader>Chart Palette</SectionHeader>
                <div className="flex flex-wrap gap-1">
                    {palette.map((color, i) => (
                        <label key={i} className="cursor-pointer">
                            <input
                                type="color"
                                value={color}
                                onChange={(e) => {
                                    const newPalette = [...palette];
                                    newPalette[i] = e.target.value;
                                    update({ chartColorPalette: newPalette });
                                }}
                                className="w-8 h-8 rounded-md border border-surface-200 dark:border-surface-700 cursor-pointer p-0"
                                style={{ WebkitAppearance: "none", appearance: "none" }}
                            />
                        </label>
                    ))}
                </div>

                {/* ── Chart Colors ── */}
                <SectionHeader>Chart Colors</SectionHeader>
                <div className="grid grid-cols-2 gap-2">
                    <ColorSwatch
                        color={theme.chartTextColor ?? d.chartTextColor}
                        onChange={(c) => update({ chartTextColor: c })}
                        label="Axis text"
                    />
                    <ColorSwatch
                        color={theme.chartGridColor ?? d.chartGridColor}
                        onChange={(c) => update({ chartGridColor: c })}
                        label="Grid lines"
                    />
                    <ColorSwatch
                        color={theme.chartBg ?? d.bg}
                        onChange={(c) => update({ chartBg: c })}
                        label="Chart bg"
                    />
                </div>

                {/* ── Scorecard ── */}
                <SectionHeader>Scorecard</SectionHeader>
                <div className="grid grid-cols-2 gap-2">
                    <ColorSwatch
                        color={theme.scorecardValueColor ?? d.scorecardValueColor}
                        onChange={(c) => update({ scorecardValueColor: c })}
                        label="Value"
                    />
                    <ColorSwatch
                        color={theme.scorecardLabelColor ?? d.scorecardLabelColor}
                        onChange={(c) => update({ scorecardLabelColor: c })}
                        label="Label"
                    />
                </div>

                {/* ── Table ── */}
                <SectionHeader>Table</SectionHeader>
                <div className="grid grid-cols-2 gap-2">
                    <ColorSwatch
                        color={theme.tableHeaderBg ?? d.tableHeaderBg}
                        onChange={(c) => update({ tableHeaderBg: c })}
                        label="Header bg"
                    />
                    <ColorSwatch
                        color={theme.tableHeaderColor ?? d.tableHeaderColor}
                        onChange={(c) => update({ tableHeaderColor: c })}
                        label="Header text"
                    />
                    <ColorSwatch
                        color={theme.tableBorderColor ?? d.tableBorderColor}
                        onChange={(c) => update({ tableBorderColor: c })}
                        label="Border"
                    />
                    <ColorSwatch
                        color={theme.tableStripeColor ?? d.bg}
                        onChange={(c) => update({ tableStripeColor: c })}
                        label="Stripe"
                    />
                </div>

                {/* ── Reset ── */}
                <div className="mt-6 pt-4 border-t border-surface-200 dark:border-surface-800">
                    <Button
                        variant="text"
                        color="neutral"
                        size="small"
                        className="w-full"
                        onClick={() => {
                            // Clearing mode: undefined restores system preference via DashboardThemeProvider cleanup
                            const reset: typeof theme = {};
                            setTheme(reset);
                            onThemeChange?.(reset);
                        }}
                    >
                        Reset to defaults
                    </Button>
                </div>
            </div>
        </div>
    );
}
