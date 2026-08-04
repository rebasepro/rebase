import type { NumberFormatOptions } from "@rebasepro/admin-types";

/**
 * Write a number out for reading, per a property's declared `admin.format`.
 *
 * Nothing is inferred here. With no options the number is returned as it came
 * out of the database — `String(value)`, not a locale-grouped rendering — so a
 * panel that declares nothing shows exactly the stored value, and an author who
 * wants thousands separators asks for them.
 *
 * `Intl.NumberFormat` throws on a bad currency code or an out-of-range fraction
 * count, and a record must not blank because one property is misconfigured, so a
 * failure falls back to the raw value.
 */
export function formatNumber(
    value: number,
    options: NumberFormatOptions | undefined,
    fallbackLocale?: string
): string {

    if (!options) return String(value);

    // A currency code is the whole declaration in the common case: writing
    // `{ currency: "EUR" }` and getting a bare `185.11` because `style` was
    // omitted is a trap, and there is nothing else `currency` could mean.
    const style = options.style ?? (options.currency ? "currency" : "decimal");

    if (style === "currency" && !options.currency) {
        // `Intl` throws on this rather than picking a currency, which is the
        // right call — there is no sensible default — but the record still has
        // to render.
        return String(value);
    }

    try {
        return new Intl.NumberFormat(options.locale ?? fallbackLocale ?? undefined, {
            style,
            currency: options.currency,
            minimumFractionDigits: options.minimumFractionDigits,
            maximumFractionDigits: options.maximumFractionDigits,
            notation: options.notation
        }).format(value);
    } catch {
        return String(value);
    }
}
