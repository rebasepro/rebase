/**
 * Dynamic Google Fonts loader.
 * Injects a <link> tag into <head> the first time a given font is requested.
 */

const loadedFonts = new Set<string>();

const SYSTEM_FONTS = new Set([
    "Arial",
    "Helvetica",
    "Helvetica Neue",
    "Times New Roman",
    "Times",
    "Courier New",
    "Courier",
    "Verdana",
    "Georgia",
    "Palatino",
    "Garamond",
    "Comic Sans MS",
    "Trebuchet MS",
    "Impact",
    "Lucida Console",
    "Tahoma",
    "system-ui",
    "sans-serif",
    "serif",
    "monospace",
    "ui-sans-serif",
    "ui-serif",
    "ui-monospace",
    // App bundled fonts
    "Geist Sans",
    "IBM Plex Mono",
    "Inter",
]);

/**
 * Dynamically loads a Google Font by injecting a stylesheet link.
 * Safe to call multiple times — duplicate requests are de-duped.
 * System / bundled fonts are silently skipped.
 */
export function loadGoogleFont(fontFamily: string): void {
    if (!fontFamily) return;

    // Normalise: strip surrounding quotes
    const clean = fontFamily.replace(/^['"]|['"]$/g, "").trim();
    if (!clean || loadedFonts.has(clean) || SYSTEM_FONTS.has(clean)) return;

    loadedFonts.add(clean);

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(clean)}:wght@300;400;500;600;700;800&display=swap`;
    document.head.appendChild(link);
}

/**
 * Load all font families referenced in a theme object.
 */
export function loadThemeFonts(theme: {
    fontFamily?: string;
    titleFontFamily?: string;
    chartFontFamily?: string;
}): void {
    if (theme.fontFamily) loadGoogleFont(theme.fontFamily);
    if (theme.titleFontFamily) loadGoogleFont(theme.titleFontFamily);
    if (theme.chartFontFamily) loadGoogleFont(theme.chartFontFamily);
}
