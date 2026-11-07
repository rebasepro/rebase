import type { InsightFormat } from "./types";

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

/** The `Intl.NumberFormat` options an insight's format stands for. */
export function numberFormatOptions(format: InsightFormat | undefined): Intl.NumberFormatOptions {
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

    return options;
}

/** Writes a value the way its insight asks, in the admin panel's language. */
export function formatValue(value: number, format: InsightFormat | undefined, locale: string | undefined): string {
    return numberFormat(locale, numberFormatOptions(format)).format(value);
}
