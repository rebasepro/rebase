/**
 * A number formatter in the given language, falling back to the browser's
 * when the language is not a tag `Intl` accepts (i18next's `cimode`, a custom
 * bundle name).
 */
export function numberFormat(locale: string | undefined, options: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
    try {
        return new Intl.NumberFormat(locale, options);
    } catch {
        return new Intl.NumberFormat(undefined, options);
    }
}

/** Writes `value` with `options`, in `locale`. */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions, locale?: string): string {
    return numberFormat(locale, options).format(value);
}

/**
 * The same format, compact: `12.9K`, `$4.2M`. For axis ticks, where the
 * reader needs the magnitude, not the last digit.
 */
export function compactFormat(options: Intl.NumberFormatOptions | undefined): Intl.NumberFormatOptions {
    return { ...options, notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1 };
}

export type ChangeDirection = "up" | "down" | "flat";
export type ChangeTone = "positive" | "negative" | "neutral";

export interface Change {
    direction: ChangeDirection;
    /** Whether the change is good news, given which way is good. */
    tone: ChangeTone;
    /** The size of the change, unsigned: the direction carries the sign. */
    magnitude: string;
}

/**
 * The change from `previous` to `current`.
 *
 * Written as a percentage unless `show` is `"absolute"`. A percentage needs a
 * previous figure to be a percentage of, so a change from zero is written as
 * the difference instead. Under 10% keeps one decimal (`0.2%`), above it none
 * (`42%`): the decimal stops carrying information once the change is that large.
 */
export function describeChange({ current, previous, goodWhen = "up", show = "percent", format, locale }: {
    current: number;
    previous: number;
    goodWhen?: "up" | "down";
    show?: "percent" | "absolute";
    format?: Intl.NumberFormatOptions;
    locale?: string;
}): Change {
    const delta = current - previous;
    const direction: ChangeDirection = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
    const tone: ChangeTone = direction === "flat" ? "neutral" : direction === goodWhen ? "positive" : "negative";

    if (show !== "absolute" && previous !== 0) {
        const ratio = Math.abs(delta / previous);
        const decimals = ratio < 0.1 ? 1 : 0;
        const magnitude = formatNumber(ratio, { style: "percent", minimumFractionDigits: decimals, maximumFractionDigits: decimals }, locale);
        return { direction, tone, magnitude };
    }
    return { direction, tone, magnitude: formatNumber(Math.abs(delta), format, locale) };
}

/** 1, 2 or 5 times a power of ten, at least `raw`. */
function niceStep(raw: number): number {
    const power = 10 ** Math.floor(Math.log10(raw));
    const residual = raw / power;
    return (residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10) * power;
}

/**
 * Round axis ticks covering `[min, max]`, about `count` intervals of them,
 * always including zero: bars and areas grow from it, and an axis that
 * starts elsewhere overstates every difference.
 */
export function niceTicks(min: number, max: number, count = 4): number[] {
    const low = Math.min(0, min);
    const high = Math.max(0, max);
    if (high === low) return [0];
    const step = niceStep((high - low) / count);
    const ticks: number[] = [];
    // Up to the first tick at or past the maximum, so the top mark is under the axis.
    for (let i = Math.floor(low / step); ; i++) {
        // Rounded, so 3 × 0.1 reads 0.3 rather than 0.30000000000000004.
        const tick = Number((i * step).toPrecision(12));
        ticks.push(tick);
        if (tick >= high) break;
    }
    return ticks;
}
