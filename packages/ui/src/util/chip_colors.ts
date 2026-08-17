import { hashString } from "./hash";

export type ChipColorScheme = {
    color: string;
    text: string;
    /** Background color override for dark mode */
    darkColor?: string;
    /** Text color override for dark mode */
    darkText?: string;
    /**
     * Ink for the `outlined` variant, which has no fill of its own.
     *
     * `text`/`darkText` are the ink ON the chip's own background. An outlined
     * chip drops that background and sits on the PAGE, so the same value is
     * being asked to be legible against two different surfaces at once — and
     * for most hues it cannot be. Splitting the roles is what lets the filled
     * ink follow its fill (often dark ink on a bright chip) without dragging
     * the outlined variant down with it.
     */
    outlineText?: string;
    /** Outlined-variant ink in dark mode. */
    darkOutlineText?: string;
}

/* ────────────────────────────────────────────────────────────────────────────
   Contrast
   ────────────────────────────────────────────────────────────────────────────

   Chip ink is DERIVED, not hand-picked. It used to be written down per tone —
   `"#fff"` on every `solid` background, the hue's `pale` on every `deep` one —
   and an audit of all 120 hue/tone/mode pairs found **63 of them below WCAG AA**.
   The worst was white on `teal.solid` at **1.76:1**, which is not a near miss;
   it is unreadable. The palette is an Airtable-style one whose mid stops are
   bright enough to need dark ink, and hardcoding light ink ignored that.

   So the ink is measured against the background it will actually sit on, and
   pushed toward black or white only as far as it must go to clear the floor.
   Starting from the hue's own dark/light tints rather than from flat `#000`
   and `#fff` keeps the family looking like a family: `blue.solid` gets a very
   dark navy, not black.

   Deriving it also means a new hue cannot be added below AA — there is no
   per-tone ink to forget to check. */

/** WCAG floor, plus a little margin so rounding cannot drop a pair below 4.5. */
const CONTRAST_TARGET = 4.6;

/** Page backgrounds the outlined variant sits on: `bg-white` and `surface-950`. */
const PAGE_LIGHT = "#ffffff";
const PAGE_DARK = "#0a0a0a";

function toRgb(hex: string): [number, number, number] {
    let h = hex.replace("#", "");
    if (h.length === 3) h = h.split("").map(c => c + c).join("");
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex(rgb: number[]): string {
    return "#" + rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
}

function relativeLuminance(hex: string): number {
    const [r, g, b] = toRgb(hex).map(v => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
    const x = relativeLuminance(a);
    const y = relativeLuminance(b);
    const [hi, lo] = x > y ? [x, y] : [y, x];
    return (hi + 0.05) / (lo + 0.05);
}

function mixHex(from: string, to: string, t: number): string {
    const A = toRgb(from);
    const B = toRgb(to);
    return toHex([0, 1, 2].map(i => A[i] + (B[i] - A[i]) * t));
}

/**
 * Walk a tinted ink toward black or white until it clears the floor on `bg`.
 *
 * Stops at the first passing step rather than going all the way, so the ink
 * keeps as much of its hue as legibility allows.
 */
function push(base: string, toward: string, bg: string): string {
    for (let t = 0; t <= 1.0001; t += 0.02) {
        const candidate = mixHex(base, toward, t);
        if (contrastRatio(candidate, bg) >= CONTRAST_TARGET) return candidate;
    }
    return toward;
}

/** The ink for a chip filled with `bg`: whichever direction has more headroom. */
function inkOn(stops: HueStops, bg: string): string {
    const dark = push(stops.text, "#000000", bg);
    const light = push(stops.onDeep ?? stops.pale, "#ffffff", bg);
    return contrastRatio(dark, bg) >= contrastRatio(light, bg) ? dark : light;
}

/**
 * The hues a chip can take, and the four stops each one is built from.
 *
 * `pale` and `mid` are backgrounds for dark text; `solid` and `deep` are
 * backgrounds for light text. `text` is the dark ink used on the two pale
 * stops, and `onDeep` the light ink on `deep` — it defaults to `pale`, and is
 * only set where a hue needs a tint of its own to stay legible.
 */
type HueStops = {
    pale: string;
    mid: string;
    solid: string;
    deep: string;
    text: string;
    onDeep?: string;
}

export const CHIP_HUES = [
    "blue", "cyan", "teal", "green", "yellow", "orange", "red", "pink", "purple", "gray",
    "indigo", "violet", "fuchsia", "rose", "emerald"
] as const;

export type ChipHue = typeof CHIP_HUES[number];

/**
 * How light or saturated a chip of a given hue is.
 *
 * A hue on its own (`"blue"`) means `Lighter` — the tone the picker offers and
 * the one seeded chips used to be limited to.
 */
export type ChipTone = "Lighter" | "Light" | "Dark" | "Darker";

export type ChipColorKey = ChipHue | `${ChipHue}${ChipTone}`;

const HUE_STOPS: Record<ChipHue, HueStops> = {
    blue: { pale: "#cfdfff", mid: "#9cc7ff", solid: "#2d7ff9", deep: "#2750ae", text: "#102046" },
    cyan: { pale: "#d0f0fd", mid: "#77d1f3", solid: "#18bfff", deep: "#0b76b7", text: "#04283f" },
    teal: { pale: "#c2f5e9", mid: "#72ddc3", solid: "#20d9d2", deep: "#06a09b", text: "#012524", onDeep: "#daf3e9" },
    green: { pale: "#d1f7c4", mid: "#93e088", solid: "#20c933", deep: "#338a17", text: "#0b1d05" },
    yellow: { pale: "#ffeab6", mid: "#ffd66e", solid: "#fcb400", deep: "#b87503", text: "#3b2501" },
    orange: { pale: "#fee2d5", mid: "#ffa981", solid: "#ff6f2c", deep: "#d74d26", text: "#6b2613" },
    red: { pale: "#ffdce5", mid: "#ff9eb7", solid: "#f82b60", deep: "#ba1e45", text: "#4c0c1c" },
    pink: { pale: "#ffdaf6", mid: "#f99de2", solid: "#ff08c2", deep: "#b2158b", text: "#400832" },
    purple: { pale: "#ede2fe", mid: "#cdb0ff", solid: "#8b46ff", deep: "#6b1cb0", text: "#280b42" },
    gray: { pale: "#eeeeee", mid: "#cccccc", solid: "#666666", deep: "#444444", text: "#040404" },
    indigo: { pale: "#e0e7ff", mid: "#a5b4fc", solid: "#6366f1", deep: "#4f46e5", text: "#312e81" },
    violet: { pale: "#ede9fe", mid: "#c4b5fd", solid: "#8b5cf6", deep: "#7c3aed", text: "#4c1d95" },
    fuchsia: { pale: "#fae8ff", mid: "#f0abfc", solid: "#d946ef", deep: "#c026d3", text: "#701a75" },
    rose: { pale: "#ffe4e6", mid: "#fda4af", solid: "#f43f5e", deep: "#e11d48", text: "#881337" },
    emerald: { pale: "#d1fae5", mid: "#6ee7b7", solid: "#10b981", deep: "#059669", text: "#064e3b" }
};

/**
 * One tone of one hue.
 *
 * Backgrounds are the palette's, unchanged — the stops were not the problem and
 * moving them would have restyled every chip in the product. Only the ink moved,
 * and it moved to wherever the measurement says it has to be.
 */
function tone(stops: HueStops, chipTone: ChipTone): ChipColorScheme {
    // The outlined variant is a property of the HUE, not of the tone: it has no
    // fill, so every tone of a hue sits on the same page background and wants
    // the same ink.
    const outline = {
        outlineText: push(stops.text, "#000000", PAGE_LIGHT),
        darkOutlineText: push(stops.onDeep ?? stops.pale, "#ffffff", PAGE_DARK)
    };

    const filled = (light: string, dark: string): ChipColorScheme => ({
        color: light,
        text: inkOn(stops, light),
        darkColor: dark,
        darkText: inkOn(stops, dark),
        ...outline
    });

    switch (chipTone) {
        case "Light":
            return filled(stops.mid, stops.solid);
        case "Dark":
            return filled(stops.solid, stops.solid);
        case "Darker":
            return filled(stops.deep, stops.deep);
        case "Lighter":
        default:
            return filled(stops.pale, stops.deep);
    }
}

const CHIP_TONES: ChipTone[] = ["Lighter", "Light", "Dark", "Darker"];

function buildChipColors(): Record<ChipColorKey, ChipColorScheme> {
    const colors = {} as Record<ChipColorKey, ChipColorScheme>;
    for (const hue of CHIP_HUES) {
        const stops = HUE_STOPS[hue];
        for (const chipTone of CHIP_TONES) {
            colors[`${hue}${chipTone}` as ChipColorKey] = tone(stops, chipTone);
        }
        // The bare hue is the lightest tone, which is what every existing
        // `color: "blue"` in a collection config already means.
        colors[hue] = tone(stops, "Lighter");
    }
    return colors;
}

/**
 * Every chip scheme, keyed by hue and tone.
 *
 * This table used to hold four tones per hue and was flattened to one, which
 * left `blueDark`, `redDarker` and friends resolving to `undefined` — a chip
 * with a colour in its config rendering with no colour at all — and left seeded
 * chips picking from ten schemes, so a five-value enum routinely drew the same
 * background three times. The tones are generated from {@link HUE_STOPS} now,
 * so a new hue brings its whole family with it.
 */
export const CHIP_COLORS: Record<ChipColorKey, ChipColorScheme> = buildChipColors();

/**
 * The keys a seeded chip may be assigned, in a stable order.
 *
 * The bare-hue aliases are excluded: they are the same scheme as `<hue>Lighter`
 * and would make the palest tone twice as likely as any other.
 */
export const CHIP_SEED_KEYS: ChipColorKey[] = CHIP_HUES.flatMap(
    hue => CHIP_TONES.map(chipTone => `${hue}${chipTone}` as ChipColorKey));

// `string & {}` keeps the known keys in autocomplete while still accepting the
// arbitrary column colours a board hands over.
export function getColorSchemeForKey(key: ChipColorKey | (string & {})): ChipColorScheme {
    // An unknown key is a config that names a colour this build does not have —
    // a renamed hue, or a value typed by hand. Seeding from the key keeps it
    // coloured and keeps it stable, rather than dropping it to no colour.
    return CHIP_COLORS[key as ChipColorKey] ?? getColorSchemeForSeed(String(key));
}

export function getColorSchemeForSeed(seed: string): ChipColorScheme {
    const hash: number = hashString(seed);
    return CHIP_COLORS[CHIP_SEED_KEYS[hash % CHIP_SEED_KEYS.length]];
}
