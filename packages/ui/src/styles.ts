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
export const focusedInvisibleMixin = "focus:bg-surface-field-hover";

/**
 * The focus ring — the single most-seen interaction state in the product, and
 * until now the least tended.
 *
 * Three dead declarations were removed rather than reshuffled:
 *   `outline-hidden` + `outline-none`  — the same instruction twice.
 *   `ring-primary` + `ring-primary/50` — the first could never win.
 *   `ring-opacity-50`                  — Tailwind v3 syntax. v4 expresses
 *                                        opacity with the `/50` slash form, so
 *                                        this generated nothing at all.
 *
 * What is left is the ring that was actually rendering, at 60% rather than 50%:
 * on `surface-900` the old value sat close enough to the field's own border to
 * be missed at a glance, which is the one thing a focus ring may not be.
 * `ring-offset-0` + a transparent offset stay — without them the ring draws a
 * white halo on dark surfaces.
 */
export const focusedClasses = "z-30 outline-none ring-2 ring-primary/60 ring-offset-0 ring-offset-transparent";

/**
 * Field surfaces.
 *
 * A field is the one surface that goes the other way: it is INSET into
 * whatever holds it, so `surface-field` is an alpha fill rather than a solid,
 * and it composes over a card, the sheet or a dialog alike. It also carries
 * the hairline: a field is an object (DESIGN.md rule 2), and without the line
 * a 4% fill on a card reads as a soft slab rather than a control — measured on
 * the product form, eight of them in a row looked like a wall. The reference
 * draws every input with its 1px edge, on both themes.
 *
 * The 1px inset top highlight that used to sit here was the recessed-edge
 * device from before the field had a border; with a real hairline above it
 * the two stacked into a doubled top edge. The border does its work now.
 *
 * Exactly one element carries this mixin per field — the box, never the
 * input inside it — so the alpha fill and its hover composite once.
 */
export const fieldBackgroundMixin = "bg-surface-field border border-hairline";
export const fieldBackgroundInvisibleMixin = "bg-transparent";
export const fieldBackgroundDisabledMixin = "bg-surface-field/60";

/**
 * `transition-colors` here, because every other interactive surface in the kit
 * has it and fields did not — `cardClickableMixin` eases, a TextField snapped.
 * On a form of eight fields that difference is the whole feel of the screen.
 */
export const fieldBackgroundHoverMixin = "transition-colors duration-150 hover:bg-surface-field-hover";

/**
 * The hairline. One value per theme (`--hairline` in theme.css), and where it
 * goes matters more than what it is: a line marks an OBJECT — a card on the
 * sheet, a field, a floating surface. It does not mark a region: a tile inside
 * a card, a row, a segmented track, a button, a chip are fills, and the
 * lightness step between them is the whole separation. One exception, and it
 * is the sheet's own edge against the frame: that step is about 3 L* on both
 * themes and did not read on a real screen, so the Scaffold draws this line
 * there. Measured before this existed, the panel drew the same line on every
 * card and every tile as well, and with only two surface values available the
 * line was doing the work a step should have done.
 */
export const defaultBorderMixin = "border-hairline";

// ---------------------------------------------------------------------------
// Surfaces are named by ROLE (see theme.css) and the theme decides the value.
// Every nested surface is one step lifted from the surface it sits on, on both
// themes. The reasoning and the measurements behind the ladder are in
// docs/plans/surface-system-2026-09.md.
//
// Two kinds of card, and the difference is what the border is for.
//
// A **floating** surface — a menu, a dialog, a popover — sits OVER the page. It
// has to be legible against whatever happens to be underneath it, so its edge
// is definite: `hairline-strong`. That is `paperMixin`.
//
// A **page** surface — a card in the document flow — sits ON the sheet, and it
// is already one step lighter than the sheet. It keeps a plain hairline, which
// is all a card on the sheet needs; once the step is there the line is close
// to optional, and a stronger one reads as a box drawn around content.
// ---------------------------------------------------------------------------
export const paperMixin = "bg-surface-card rounded-lg border border-hairline-strong";
export const cardMixin = "bg-surface-card rounded-xl border border-hairline";

/**
 * An inset well: code, a query, a log tail, a connection string.
 *
 * It must read as *recessed into* the surface holding it, which means darker
 * than that surface in dark mode. Cards now sit at `surface-card` (#181818),
 * so #0a0a0a is already fourteen units below and reads as a well; #000 was
 * tuned for the old #0a card and is now harsher than it needs to be. That value
 * is the `surface-well` role (theme.css), the one surface that goes DOWN the
 * ladder on purpose. Pair with `font-mono`; this mixin carries the surface
 * only.
 */
export const codeSurfaceMixin = "bg-surface-well rounded-md";

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

/**
 * Hover on a SOLID surface goes one step lighter, and it stays neutral. The
 * previous `hover:bg-primary/5` tinted every clickable card blue, which spent
 * the brand colour on a state that carries no meaning; on the dark ladder it
 * also read as a hue shift rather than a lift.
 */
export const cardClickableMixin = "hover:bg-surface-card-hover cursor-pointer transition-colors duration-150";
export const cardSelectedMixin = "bg-primary-bg/30 dark:bg-primary-bg/10 ring-1 ring-primary/75";

/**
 * Hover on a TRANSPARENT ground — a nav item, a menu item, a list row, a tree
 * row. `surface-hover` is an alpha fill, so it lifts whatever it lands on by
 * the same amount, and `surface-active` is the same idea one step further for
 * the selected row when no hue is wanted. Do not use these on a solid card:
 * an alpha fill REPLACES a solid background rather than tinting it.
 */
export const surfaceHoverMixin = "hover:bg-surface-hover transition-colors duration-150";
export const surfaceActiveMixin = "bg-surface-active";
