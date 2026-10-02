import { useMemo } from "react";
import { en } from "../../app/src/locales/en";

/**
 * `t` over the English catalogue, resolved the way i18next resolves it:
 * `{{name}}` is interpolated, and a `count` of exactly 1 reads the key's
 * `_one` form before the key itself — the only plural rule English has.
 */
export function translateEn(key: string, vars?: Record<string, string | number>): string {
    const singular = vars?.count === 1 ? en[`${key}_one` as keyof typeof en] : undefined;
    let text: string = singular ?? en[key as keyof typeof en] ?? key;
    for (const [name, value] of Object.entries(vars ?? {})) text = text.replaceAll(`{{${name}}}`, String(value));
    return text;
}

/**
 * `useTranslation` for a mocked `@rebasepro/app`. It goes through a hook, as
 * the real one does, so a render test still trips over a component that calls
 * its hooks in a different order from one render to the next.
 */
export function useEnTranslation() {
    return useMemo(() => ({
        t: translateEn,
        i18n: { language: "en" }
    }), []);
}
