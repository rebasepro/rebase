/**
 * The locales a product can be translated into: the values a
 * `product_locales.locale` and a `products.available_locales` entry may hold.
 *
 * A closed set, so it is declared as one rather than left as free text: an
 * array of plain strings renders as a repeat panel — a stack of empty text
 * inputs with an "Add" button, one row per locale — while an array with known
 * values renders as a multi select. Same data, a quarter of the height, and no
 * way to store `EN`, `en-US` and `english` in the same column.
 *
 * Only the values: what the panel calls each one is the CMS's business
 * (`frontend/src/cms/lib/locales.ts`).
 */
export const LOCALES = ["en", "es", "fr", "de", "it"] as const;

/** One of {@link LOCALES}. */
export type Locale = (typeof LOCALES)[number];
