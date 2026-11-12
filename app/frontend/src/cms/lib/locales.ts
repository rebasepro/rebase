import type { Locale } from "../../../../backend/lib/locales";

/**
 * What the panel calls each locale a product can be translated into. The
 * values themselves are the backend's (`backend/lib/locales.ts`); naming the
 * type here makes a locale added there without a label a type error.
 */
export const LOCALE_LABELS: Record<Locale, string> = {
    en: "English",
    es: "Spanish",
    fr: "French",
    de: "German",
    it: "Italian"
};
