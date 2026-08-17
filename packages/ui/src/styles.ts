// ---------------------------------------------------------------------------
// Control size scale — the single source of truth for how tall an inline
// control is.
//
// Every control that sits on a line with another control (buttons, text
// fields, selects, search bars, date fields, icon buttons, checkboxes) resolves
// its height from this map, so a Button and a TextField at the same `size` are
// pixel-identical and share a baseline. Before this existed each component
// carried its own map and `size="large"` meant 42px on a Button and 64px on a
// TextField.
//
// The scale is 28/32/40/48 — the rhythm IconButton and Checkbox already used.
// `xl`/`2xl` continue above it and are button-only.
// ---------------------------------------------------------------------------

export type ControlSize = "smallest" | "small" | "medium" | "large";
export type ButtonSize = ControlSize | "xl" | "2xl";

export const CONTROL_HEIGHT = {
    smallest: 28,
    small: 32,
    medium: 40,
    large: 48,
    xl: 56,
    "2xl": 64
} as const satisfies Record<ButtonSize, number>;

/** Tailwind min-height class per control size. Keep in sync with CONTROL_HEIGHT. */
export const controlHeightMixin = {
    smallest: "min-h-[28px]",
    small: "min-h-[32px]",
    medium: "min-h-[40px]",
    large: "min-h-[48px]",
    xl: "min-h-[56px]",
    "2xl": "min-h-[64px]"
} as const satisfies Record<ButtonSize, string>;

/** Horizontal padding paired with each size, so gutters scale with height. */
export const controlPaddingMixin = {
    smallest: "px-2",
    small: "px-2",
    medium: "px-3",
    large: "px-4",
    xl: "px-6",
    "2xl": "px-10"
} as const satisfies Record<ButtonSize, string>;

export const focusedDisabled = "focus-visible:ring-0 focus-visible:ring-offset-0";
export const focusedInvisibleMixin = "focus:bg-opacity-70 focus:bg-surface-accent-100 focus:dark:bg-white/[0.07] focus:bg-surface-accent-100/70";
export const focusedClasses = "z-30 outline-hidden outline-none ring-2 ring-primary ring-opacity-50 ring-primary/50 ring-offset-0 ring-offset-transparent ";
export const fieldBackgroundMixin = "bg-surface-accent-200/50 dark:bg-white/[0.055]";
export const fieldBackgroundInvisibleMixin = "bg-surface-accent-200/0 dark:bg-white/0";
export const fieldBackgroundDisabledMixin = "bg-surface-accent-200/50 dark:bg-white/[0.03]";
export const fieldBackgroundHoverMixin = "hover:bg-surface-accent-200/70 hover:dark:bg-white/[0.09]";
export const defaultBorderMixin = "border-surface-200 dark:border-surface-700/60 ";

// ---------------------------------------------------------------------------
// Surfaces: two kinds, and the difference is what the border is for.
//
// A **floating** surface — a menu, a dialog, a popover — sits OVER the page. It
// has to be legible against whatever happens to be underneath it, so its edge
// is definite: solid `surface-700`. That is `paperMixin`.
//
// A **page** surface — a card in the document flow — sits ON the page, and the
// page is already `surface-950`/`surface-900`. A solid edge there reads as a
// box drawn around content rather than as the content having a surface, which
// is why every serious caller was overriding it: 53 `<Card>` sites in the SaaS
// console alone re-declared this border at `/60`, the same value
// `defaultBorderMixin` above has always used. The component was wrong and the
// callers were right, so the component now says what they meant.
// ---------------------------------------------------------------------------
export const paperMixin = "bg-white rounded-lg dark:bg-surface-900 border border-surface-200 dark:border-surface-700";
export const cardMixin = "bg-white dark:bg-surface-900 rounded-xl border border-surface-200 dark:border-surface-700/60";

/**
 * An inset well: code, a query, a log tail, a connection string.
 *
 * It must read as *recessed into* the surface holding it, which means darker
 * than that surface in dark mode — `surface-950` under a `surface-900` card.
 * The obvious-looking `surface-800` is a trap: `#111111` is LIGHTER than the
 * `#0a0a0a` card around it, so the well appears to float above the thing it is
 * set into. Pair with `font-mono`; this mixin carries the surface only.
 */
export const codeSurfaceMixin = "bg-surface-100 dark:bg-surface-950 rounded-md";

/**
 * The accent, used as TEXT.
 *
 * `--color-primary` (#0070F4) is tuned to be a fill — white text on it, it on
 * white. Read as text on our dark surfaces it lands at **4.36:1 on a
 * `surface-900` card** (measured), which is below AA for body-sized text, and
 * every accent link in the product sits on exactly that surface. On the page's
 * `surface-950` it only reaches 4.62:1, so the margin was never real.
 *
 * `--color-primary-light` is the same hue lifted 0.15 in OKLCH lightness and
 * measures **7.34:1** on the same card. It is indistinguishable as "the blue"
 * and comfortably legible, so dark mode swaps to it for text.
 *
 * Use this for links, accent labels and any accent-coloured type. It is NOT for
 * fills — a filled button keeps `bg-primary`, where the contrast question runs
 * the other way and #0070F4 is already correct.
 */
export const accentTextMixin = "text-primary dark:text-primary-light";
export const cardClickableMixin = "hover:bg-primary/5 dark:hover:bg-primary/5 cursor-pointer transition-colors duration-150";
export const cardSelectedMixin = "bg-primary-bg/30 dark:bg-primary-bg/10 ring-1 ring-primary/75";
