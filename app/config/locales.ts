import type { EnumValueConfig } from "@rebasepro/types";

/**
 * The locales a product can be translated into.
 *
 * A closed set, so it is declared as an enum rather than left as free text:
 * an `array` of plain strings renders as a repeat panel — a stack of empty
 * text inputs with an "Add" button, one row per locale — while an `array` of
 * an enum renders as a multi select. Same data, a quarter of the height, and
 * no way to store `EN`, `en-US` and `english` in the same column.
 */
export const LOCALE_ENUM: EnumValueConfig[] = [
    { id: "en", label: "English" },
    { id: "es", label: "Spanish" },
    { id: "fr", label: "French" },
    { id: "de", label: "German" },
    { id: "it", label: "Italian" }
];
