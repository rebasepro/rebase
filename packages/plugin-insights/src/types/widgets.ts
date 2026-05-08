/**
 * Tabular data types used by insight widgets.
 */

/** A single row of data as key-value pairs. */
export type DataRow = Record<string, string | number | boolean | null>;

/**
 * Formatting options for scorecard numbers.
 * Uses Intl.NumberFormat standard.
 */
export interface ScorecardFormat {
    /**
     * The style of formatting.
     * - `decimal`: 1,234.5
     * - `currency`: $1,234.50
     * - `percent`: 12.5%
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

    /** If true, adds a '+' sign for positive numbers (e.g., +12.5%) */
    showSign?: boolean;
}

/**
 * Scorecard widget configuration — field mapping + formatting.
 */
export interface ScorecardConfig {
    /** Main value configuration */
    value: {
        /** The column name from the query result for the main value */
        field: string;
        /** How to format this number */
        format?: ScorecardFormat;
    };
    /** Comparison value configuration (optional) */
    comparison?: {
        /** The column name from the query result for the comparison value */
        field: string;
        /** How to format this number */
        format?: ScorecardFormat;
        /**
         * Determines the color (green/red) based on the value.
         * - `increase_is_good`: Positive = green, negative = red.
         * - `decrease_is_good`: Positive = red, negative = green.
         */
        intent: "increase_is_good" | "decrease_is_good";
    };
    /** Optional icon key (e.g., "shopping_cart", "users") — resolved via getIcon */
    icon?: string;
    /** Optional date range text (e.g., "Last 30 days") */
    dateRange?: string;
}
