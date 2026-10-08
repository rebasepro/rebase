import type { InsightComparison, InsightFormat } from "./types";

/**
 * A number formatter in the given language, falling back to the browser's
 * when the language is not a tag `Intl` accepts (i18next's `cimode`, a custom
 * bundle name).
 */
function numberFormat(locale: string | undefined, options: Intl.NumberFormatOptions): Intl.NumberFormat {
    try {
        return new Intl.NumberFormat(locale, options);
    } catch {
        return new Intl.NumberFormat(undefined, options);
    }
}

/** Writes a value the way its insight asks, in the admin panel's language. */
export function formatValue(value: number, format: InsightFormat | undefined, locale: string | undefined): string {
    const options: Intl.NumberFormatOptions = {
        style: format?.style ?? "decimal",
        notation: format?.notation ?? "standard"
    };

    // Only pin the fraction digits when the config asks for a specific count.
    // Without this, Intl's per-style defaults apply: integers stay integers
    // ("80", not "80.0") while currency keeps its two decimals ("$452.95").
    if (format?.decimals !== undefined) {
        options.maximumFractionDigits = format.decimals;
        options.minimumFractionDigits = format.decimals;
    }

    if (format?.style === "currency") {
        options.currency = format.currency ?? "USD";
    }

    return numberFormat(locale, options).format(value);
}

export type ChangeDirection = "up" | "down" | "flat";

export interface FormattedChange {
    direction: ChangeDirection;
    /** The size of the change, unsigned: the direction carries the sign. */
    magnitude: string;
}

/**
 * The change from `previous` to `current`, written as the comparison asks.
 *
 * A percentage needs a previous figure to be a percentage of, so a change
 * from zero is written as the difference instead. Under 10% keeps one
 * decimal (`0.2%`), above it none (`42%`): the decimal stops carrying
 * information once the change is that large.
 */
export function formatChange(
    current: number,
    previous: number,
    comparison: InsightComparison,
    format: InsightFormat | undefined,
    locale: string | undefined
): FormattedChange {
    const delta = current - previous;
    const direction: ChangeDirection = delta > 0 ? "up" : delta < 0 ? "down" : "flat";

    if (comparison.show !== "absolute" && previous !== 0) {
        const ratio = Math.abs(delta / previous);
        const decimals = ratio < 0.1 ? 1 : 0;
        return {
            direction,
            magnitude: numberFormat(locale, {
                style: "percent",
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals
            }).format(ratio)
        };
    }

    return { direction, magnitude: formatValue(Math.abs(delta), format, locale) };
}

export type ChangeTone = "positive" | "negative" | "neutral";

/** Whether a change in this direction is good news for this insight. */
export function changeTone(direction: ChangeDirection, intent: InsightComparison["intent"]): ChangeTone {
    if (direction === "flat") return "neutral";
    const good = intent === "increase_is_good" ? "up" : "down";
    return direction === good ? "positive" : "negative";
}
