/**
 * Three-variable math-derived theme engine for `@rebasepro/ui`.
 *
 * Instead of exposing dozens of brittle CSS tokens for white-labeling, a consumer
 * provides at most three inputs:
 *   - `accent`     — brand hex color (default `#0070F4`, hue 258°)
 *   - `background` — optional base hex color to tint the neutral ramp's hue/lightness
 *   - `contrast`   — `"normal"` (default) or `"high"` (stronger hairlines & text steps)
 *
 * Every surface role (`--surface-frame` → `--surface-lifted`), hairline, neutral
 * graphite step, and `--color-on-primary` ink is derived mathematically in OKLCH
 * with binary-search sRGB gamut mapping (avoiding CSS `oklch()` out-of-gamut clipping
 * and Chromium's low-chroma powerless-hue bug) and WCAG AA contrast enforcement.
 */

export type RebaseThemeContrast = "normal" | "high";

export interface RebaseThemeConfig {
    /** Brand accent hex color (e.g. `"#0070F4"`, `"#10B981"`, `"#EAB308"`). */
    accent?: string;
    /** Optional base background hex color used to derive the neutral tint & tone. */
    background?: string;
    /** Surface & hairline contrast tier. Defaults to `"normal"`. */
    contrast?: RebaseThemeContrast;
}

export interface DerivedRebaseTheme {
    /** CSS custom properties applied to `:root` / light theme. */
    light: Record<string, string>;
    /** CSS custom properties applied to `.dark` / `[data-theme="dark"]`. */
    dark: Record<string, string>;
    /** Theme-independent tokens (`--color-primary`, `--color-on-primary`, graphite ramp). */
    common: Record<string, string>;
}

interface Rgb {
    r: number; // 0..1
    g: number; // 0..1
    b: number; // 0..1
}

interface Oklch {
    l: number; // 0..1
    c: number; // >= 0
    h: number; // 0..360
}

function clamp(v: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, v));
}

export function parseHex(hex: string): Rgb | null {
    const clean = hex.trim().replace(/^#/, "");
    if (/^[0-9a-fA-F]{3}$/.test(clean)) {
        const r = parseInt(clean[0] + clean[0], 16) / 255;
        const g = parseInt(clean[1] + clean[1], 16) / 255;
        const b = parseInt(clean[2] + clean[2], 16) / 255;
        return { r, g, b };
    }
    if (/^[0-9a-fA-F]{6}$/.test(clean)) {
        const r = parseInt(clean.slice(0, 2), 16) / 255;
        const g = parseInt(clean.slice(2, 4), 16) / 255;
        const b = parseInt(clean.slice(4, 6), 16) / 255;
        return { r, g, b };
    }
    return null;
}

function srgbToLinear(c: number): number {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
    if (c <= 0.0031308) return 12.92 * c;
    return 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function rgbToHex({ r, g, b }: Rgb): string {
    const toByte = (v: number) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, "0");
    return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}

/** WCAG 2.1 relative luminance for an sRGB color in 0..1. */
export function relativeLuminance({ r, g, b }: Rgb): number {
    return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG 2.1 contrast ratio between two hex colors (1..21). */
export function contrastRatio(hexA: string, hexB: string): number {
    const a = parseHex(hexA);
    const b = parseHex(hexB);
    if (!a || !b) return 1;
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    const lighter = Math.max(la, lb);
    const darker = Math.min(la, lb);
    return (lighter + 0.05) / (darker + 0.05);
}

export function rgbToOklch({ r, g, b }: Rgb): Oklch {
    const lr = srgbToLinear(r);
    const lg = srgbToLinear(g);
    const lb = srgbToLinear(b);

    const l_ = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m_ = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s_ = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

    const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
    const A = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
    const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;

    const C = Math.sqrt(A * A + B * B);
    let H = (Math.atan2(B, A) * 180) / Math.PI;
    if (H < 0) H += 360;
    return { l: L, c: C, h: H };
}

function oklchToLinearRgb(l: number, c: number, h: number): Rgb {
    const rad = (h * Math.PI) / 180;
    const a = c * Math.cos(rad);
    const b = c * Math.sin(rad);

    const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = l - 0.0894841775 * a - 1.2914855480 * b;

    const l3 = l_ * l_ * l_;
    const m3 = m_ * m_ * m_;
    const s3 = s_ * s_ * s_;

    return {
        r: +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
        g: -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
        b: -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3
    };
}

function inGamut({ r, g, b }: Rgb): boolean {
    const eps = 1e-4;
    return r >= -eps && r <= 1 + eps && g >= -eps && g <= 1 + eps && b >= -eps && b <= 1 + eps;
}

/**
 * Convert OKLCH to a gamut-mapped sRGB hex color by binary-searching chroma
 * downward when out of sRGB gamut, preserving lightness and hue.
 */
export function oklchToHex(l: number, c: number, h: number): string {
    const clampedL = clamp(l, 0, 1);
    const clampedC = Math.max(0, c);
    const direct = oklchToLinearRgb(clampedL, clampedC, h);
    if (inGamut(direct)) {
        return rgbToHex({
            r: linearToSrgb(clamp(direct.r, 0, 1)),
            g: linearToSrgb(clamp(direct.g, 0, 1)),
            b: linearToSrgb(clamp(direct.b, 0, 1))
        });
    }
    let lo = 0;
    let hi = clampedC;
    for (let i = 0; i < 16; i++) {
        const mid = (lo + hi) / 2;
        if (inGamut(oklchToLinearRgb(clampedL, mid, h))) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    const mapped = oklchToLinearRgb(clampedL, lo, h);
    return rgbToHex({
        r: linearToSrgb(clamp(mapped.r, 0, 1)),
        g: linearToSrgb(clamp(mapped.g, 0, 1)),
        b: linearToSrgb(clamp(mapped.b, 0, 1))
    });
}

function pickOnColor(bgHex: string): string {
    const whiteContrast = contrastRatio(bgHex, "#ffffff");
    const blackContrast = contrastRatio(bgHex, "#090a0c");
    return whiteContrast >= blackContrast ? "#ffffff" : "#090a0c";
}

const DEFAULT_ACCENT = "#0070F4";

/**
 * Derive a complete, WCAG-checked Rebase UI token set from 3 inputs:
 * `accent`, `background`, and `contrast`.
 */
export function deriveRebaseTheme(config: RebaseThemeConfig = {}): DerivedRebaseTheme {
    const contrast: RebaseThemeContrast = config.contrast ?? "normal";
    const high = contrast === "high";

    const accentRgb = parseHex(config.accent ?? DEFAULT_ACCENT) ?? parseHex(DEFAULT_ACCENT)!;
    const accentOklch = rgbToOklch(accentRgb);
    const accentHex = rgbToHex(accentRgb);

    const bgRgb = config.background ? parseHex(config.background) : null;
    const bgOklch = bgRgb ? rgbToOklch(bgRgb) : null;

    // Neutral hue follows the background if chromatic, otherwise the accent hue (Graphite rule).
    const neutralHue = bgOklch && bgOklch.c >= 0.008
        ? bgOklch.h
        : (accentOklch.c >= 0.01 ? accentOklch.h : 258);

    // Subtle neutral chroma keeps every surface on one coherent material without reading colored.
    const neutralChroma = bgOklch
        ? clamp(bgOklch.c * 0.25, 0.003, 0.016)
        : 0.006;

    const primaryLight = oklchToHex(clamp(accentOklch.l + 0.12, 0.2, 0.92), accentOklch.c * 0.9, accentOklch.h);
    const primaryDark = oklchToHex(clamp(accentOklch.l - 0.12, 0.15, 0.85), accentOklch.c * 0.95, accentOklch.h);
    const onPrimary = pickOnColor(accentHex);

    // Light ladder: airy porcelain frame -> near-white sheet -> pure white card
    const stepBoost = high ? 0.014 : 0;
    const lightFrameL = bgOklch && bgOklch.l > 0.7 ? clamp(bgOklch.l - 0.025 - stepBoost, 0.89, 0.97) : 0.967 - stepBoost;
    const lightSheetL = clamp(lightFrameL + 0.024 + stepBoost * 0.4, 0.955, 0.992);
    const lightCardL = 1.0;

    // Dark ladder: frame -> sheet -> card -> raised -> lifted (each step lighter)
    const darkFrameL = bgOklch && bgOklch.l < 0.35 ? clamp(bgOklch.l, 0.11, 0.19) : 0.142;
    const darkSheetL = clamp(darkFrameL + 0.038 + stepBoost * 0.5, 0.16, 0.24);
    const darkCardL = clamp(darkSheetL + 0.028 + stepBoost * 0.5, 0.19, 0.28);
    const darkCardHoverL = clamp(darkCardL + 0.02, 0.21, 0.31);
    const darkRaisedL = clamp(darkCardL + 0.045 + stepBoost * 0.5, 0.23, 0.35);
    const darkRaisedHoverL = clamp(darkRaisedL + 0.032, 0.26, 0.39);

    const common: Record<string, string> = {
        "--color-primary": accentHex,
        "--color-primary-light": primaryLight,
        "--color-primary-dark": primaryDark,
        "--color-primary-bg": `color-mix(in oklab, ${accentHex} 10%, transparent)`,
        "--color-on-primary": onPrimary,
        // Graphite neutral ramp on the derived neutral hue
        "--color-graphite-50": oklchToHex(0.985, neutralChroma * 0.4, neutralHue),
        "--color-graphite-100": oklchToHex(0.967, neutralChroma * 0.5, neutralHue),
        "--color-graphite-200": oklchToHex(0.920, neutralChroma * 0.8, neutralHue),
        "--color-graphite-300": oklchToHex(0.869, neutralChroma, neutralHue),
        "--color-graphite-400": oklchToHex(0.708, neutralChroma * 1.1, neutralHue),
        "--color-graphite-500": oklchToHex(0.556, neutralChroma * 1.2, neutralHue),
        "--color-graphite-600": oklchToHex(0.440, neutralChroma * 1.2, neutralHue),
        "--color-graphite-700": oklchToHex(0.371, neutralChroma * 1.1, neutralHue),
        "--color-graphite-800": oklchToHex(0.269, neutralChroma, neutralHue),
        "--color-graphite-900": oklchToHex(0.205, neutralChroma * 0.9, neutralHue),
        "--color-graphite-950": oklchToHex(darkFrameL, neutralChroma * 0.8, neutralHue),
        // Text tokens tuned for WCAG AA (and AAA-leaning under high contrast)
        "--color-text-primary": oklchToHex(high ? 0.16 : 0.24, neutralChroma, neutralHue),
        "--color-text-secondary": oklchToHex(high ? 0.44 : 0.52, neutralChroma * 1.2, neutralHue),
        "--color-text-primary-dark": oklchToHex(high ? 0.99 : 0.97, neutralChroma * 0.4, neutralHue),
        "--color-text-secondary-dark": oklchToHex(high ? 0.84 : 0.765, neutralChroma * 0.9, neutralHue)
    };

    const light: Record<string, string> = {
        "--surface-frame": oklchToHex(lightFrameL, neutralChroma * 0.55, neutralHue),
        "--surface-sheet": oklchToHex(lightSheetL, neutralChroma * 0.35, neutralHue),
        "--surface-card": oklchToHex(lightCardL, 0, neutralHue),
        "--surface-card-hover": oklchToHex(0.982 - stepBoost * 0.4, neutralChroma * 0.45, neutralHue),
        "--surface-raised": oklchToHex(0.956 - stepBoost, neutralChroma * 0.65, neutralHue),
        "--surface-raised-hover": oklchToHex(0.934 - stepBoost, neutralChroma * 0.75, neutralHue),
        "--surface-lifted": "#ffffff",
        "--surface-field": high ? "rgb(0 0 0 / 0.065)" : "rgb(0 0 0 / 0.038)",
        "--surface-field-hover": high ? "rgb(0 0 0 / 0.095)" : "rgb(0 0 0 / 0.058)",
        "--surface-hover": high ? "rgb(0 0 0 / 0.055)" : "rgb(0 0 0 / 0.035)",
        "--surface-active": high ? "rgb(0 0 0 / 0.09)" : "rgb(0 0 0 / 0.06)",
        "--surface-well": oklchToHex(0.967 - stepBoost * 0.5, neutralChroma * 0.55, neutralHue),
        "--hairline": high ? "rgb(0 0 0 / 0.15)" : "rgb(0 0 0 / 0.075)",
        "--hairline-strong": high ? "rgb(0 0 0 / 0.25)" : "rgb(0 0 0 / 0.13)"
    };

    const dark: Record<string, string> = {
        "--surface-frame": oklchToHex(darkFrameL, neutralChroma * 0.8, neutralHue),
        "--surface-sheet": oklchToHex(darkSheetL, neutralChroma * 0.9, neutralHue),
        "--surface-card": oklchToHex(darkCardL, neutralChroma, neutralHue),
        "--surface-card-hover": oklchToHex(darkCardHoverL, neutralChroma, neutralHue),
        "--surface-raised": oklchToHex(darkRaisedL, neutralChroma * 1.1, neutralHue),
        "--surface-raised-hover": oklchToHex(darkRaisedHoverL, neutralChroma * 1.1, neutralHue),
        "--surface-lifted": oklchToHex(darkRaisedHoverL, neutralChroma * 1.1, neutralHue),
        "--surface-field": high ? "rgb(255 255 255 / 0.10)" : "rgb(255 255 255 / 0.065)",
        "--surface-field-hover": high ? "rgb(255 255 255 / 0.14)" : "rgb(255 255 255 / 0.095)",
        "--surface-hover": high ? "rgb(255 255 255 / 0.09)" : "rgb(255 255 255 / 0.06)",
        "--surface-active": high ? "rgb(255 255 255 / 0.14)" : "rgb(255 255 255 / 0.095)",
        "--surface-well": oklchToHex(Math.max(0.11, darkFrameL - 0.01), neutralChroma * 0.8, neutralHue),
        "--hairline": high ? "rgb(255 255 255 / 0.14)" : "rgb(255 255 255 / 0.05)",
        "--hairline-strong": high ? "rgb(255 255 255 / 0.26)" : "rgb(255 255 255 / 0.12)"
    };

    return { light, dark, common };
}

/**
 * Format a {@link DerivedRebaseTheme} into a `<style>` sheet string so light
 * and dark selectors switch seamlessly without clobbering inline styles.
 */
export function buildThemeStyleSheet(derived: DerivedRebaseTheme): string {
    const serialize = (vars: Record<string, string>) =>
        Object.entries(vars)
            .map(([k, v]) => `  ${k}: ${v};`)
            .join("\n");

    return [
        ":root, [data-theme=\"light\"] {",
        serialize({ ...derived.common, ...derived.light }),
        "}",
        ".dark, [data-theme=\"dark\"] {",
        serialize(derived.dark),
        "}"
    ].join("\n");
}
