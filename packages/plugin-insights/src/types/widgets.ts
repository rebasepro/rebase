/**
 * Data and formatting types used by insight widgets.
 */

/** One record a source returns: the figures its insights read, by field name. */
export type DataRow = Record<string, string | number | boolean | null>;

/**
 * How a figure is written. Uses `Intl.NumberFormat` in the admin panel's
 * language, so `1234.5` reads `1,234.5` in English and `1.234,5` in German.
 */
export interface InsightFormat {
    /**
     * The style of formatting.
     * - `decimal`: 1,234.5
     * - `currency`: $1,234.50
     * - `percent`: 12.5% (the value is a ratio: 0.125)
     */
    style: "decimal" | "currency" | "percent";

    /**
     * How to display the number.
     * - `standard`: 1,234,567 (default)
     * - `compact`: 1.2M
     */
    notation?: "standard" | "compact";

    /** Required if style is 'currency' (e.g., "USD", "EUR") */
    currency?: string;

    /** Number of decimal places to show */
    decimals?: number;
}
