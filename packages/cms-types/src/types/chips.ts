export type ColorScheme = {
    color: string;
    text: string;
}

/**
 * The hues a chip can take.
 *
 * Kept in step with `CHIP_HUES` in `@rebasepro/ui` by hand: config types cannot
 * depend on the component library. A hue added there needs adding here too.
 */
export type ColorHue =
    | "blue"
    | "cyan"
    | "teal"
    | "green"
    | "yellow"
    | "orange"
    | "red"
    | "pink"
    | "purple"
    | "gray"
    | "indigo"
    | "violet"
    | "fuchsia"
    | "rose"
    | "emerald";

/**
 * How light or saturated a chip is. A hue on its own means `Lighter`.
 */
export type ColorTone = "Lighter" | "Light" | "Dark" | "Darker";

export type ColorKey = ColorHue | `${ColorHue}${ColorTone}`;
