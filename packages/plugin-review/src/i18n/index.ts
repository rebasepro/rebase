import { useCallback, useMemo } from "react";
import { useTranslation } from "@rebasepro/app";
import { de } from "./de";
import { en, type ReviewTranslationKey, type ReviewTranslations } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { it } from "./it";
import { pt } from "./pt";

export type { ReviewTranslationKey, ReviewTranslations } from "./en";

/** Every bundle the plugin ships, by language. @group Review */
export const REVIEW_TRANSLATIONS: Readonly<Record<string, ReviewTranslations>> = { en,
es,
de,
fr,
it,
pt };

/** The bundle for a language tag: `pt-BR` reads `pt`, an unknown tag reads English. */
export function reviewBundleFor(language: string | undefined): ReviewTranslations {
    const base = (language ?? "en").toLowerCase().split(/[-_]/)[0];
    return REVIEW_TRANSLATIONS[base] ?? en;
}

/** `{{name}}` placeholders filled from `vars`; an unknown one is left as written. */
export function interpolate(template: string, vars?: Record<string, string | number>): string {
    if (!vars) return template;
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) =>
        Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match);
}

/**
 * The plugin's own `t`, in the panel's language.
 *
 * The plugin carries its strings rather than adding keys to the panel's
 * bundles, so installing it changes nothing outside it.
 */
export function useReviewTranslation() {
    const { i18n } = useTranslation();
    const language = i18n?.language;
    const bundle = useMemo(() => reviewBundleFor(language), [language]);
    const t = useCallback((key: ReviewTranslationKey, vars?: Record<string, string | number>) =>
        interpolate(bundle[key], vars), [bundle]);
    return { t,
language: language ?? "en" };
}
