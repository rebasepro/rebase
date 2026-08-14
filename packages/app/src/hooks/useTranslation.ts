import { useTranslation as useI18nTranslation } from "react-i18next";
import { useCallback, useMemo } from "react";

const REBASE_NS = "rebase_core";

/**
 * Internal hook for translating Rebase UI strings.
 *
 * Uses the `rebase_core` i18next namespace that is initialised by
 * `RebaseI18nProvider`. Do NOT use `react-i18next` directly in internal
 * components — always go through this hook so the namespace is consistent.
 *
 * @example
 * const { t } = useTranslation();
 * <Button>{t("save")}</Button>
 *
 * @internal
 */
export function useTranslation() {
    const { t, i18n } = useI18nTranslation(REBASE_NS);

    /**
     * Typed translation function scoped to RebaseTranslations keys.
     * Also supports i18next interpolation variables, e.g.
     *   t("add_to_field", { fieldName: "Tags" })
     *   t("error_deleting", { message: err.message })
     *   t("sort_key_position", { position: 2 })
     *
     * Numbers are accepted as well as strings: i18next interpolates them
     * either way, and a signature that took only strings pushed a `String()`
     * onto every call site with a count in it — `{{count}}`, `{{position}}`.
     */
    const typedT = useCallback((key: string, vars?: Record<string, string | number>): string =>
        t(key, vars) as string, [t]);

    return useMemo(() => ({ t: typedT,
i18n }), [typedT, i18n]);
}
