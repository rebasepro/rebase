import React, { PropsWithChildren, useEffect, useMemo, useRef } from "react";
import i18next, { BackendModule, i18n } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { loadChunk, UiLabelsProvider, type UiLabelsProviderProps } from "@rebasepro/ui";
import { en } from "../locales/en";
import { RebaseTranslations } from "@rebasepro/cms-types";
import { readStoredString, writeStoredString } from "../util/local_storage";
import { useTranslation } from "../hooks/useTranslation";

const REBASE_NS = "rebase_core";

/**
 * The translations Rebase ships besides English, each its own chunk.
 *
 * English is bundled: it is the fallback for every key, so it is needed
 * whatever the language. The other six used to be bundled too, and every
 * admin downloaded, parsed and merged ~616 kB of languages it never showed
 * before its login screen could paint. Now one is fetched the first time its
 * language is asked for — on mount, for a stored preference or a `locale`
 * prop; later, from the language menu — and i18next switches to it only once
 * it has arrived, so nobody sees keys or a flash of English.
 *
 * Keep each `import()` a literal path: that is what makes it a chunk.
 */
const LOCALE_LOADERS: Record<string, () => Promise<RebaseTranslations>> = {
    es: () => import("../locales/es").then(m => m.es),
    de: () => import("../locales/de").then(m => m.de),
    fr: () => import("../locales/fr").then(m => m.fr),
    it: () => import("../locales/it").then(m => m.it),
    hi: () => import("../locales/hi").then(m => m.hi),
    pt: () => import("../locales/pt").then(m => m.pt)
};

/**
 * Tables already fetched, shared by every provider instance. Static strings,
 * nothing per user: keyed by language code, never invalidated (a new build is
 * a new page load). Lets a remount, or a second `<Rebase>`, resolve
 * synchronously instead of awaiting the chunk again.
 */
const loadedTables: Record<string, RebaseTranslations> = { en };

export const REBASE_LOCALE_STORAGE_KEY = "rebase_locale";

/** DeepPartial helper — allows partial overrides at any nesting level */
type DeepPartial<T> = T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export interface RebaseI18nProviderProps {
    /** BCP-47 locale tag, e.g. "en", "es", "fr". Defaults to "en". */
    locale?: string;
    /**
     * Override or extend any Rebase UI string, keyed by locale.
     *
     * @example
     * translations={{
     *   en: { save: "Publish" },
     *   es: { save: "Publicar", discard: "Descartar" }
     * }}
     */
    translations?: {
        [locale: string]: DeepPartial<RebaseTranslations>;
    };
}

/**
 * Initialises a dedicated i18next instance for Rebase's internal UI strings.
 *
 * This instance is isolated from any app-level i18next configuration the
 * consumer may have. Mount this at the top of the Rebase component tree.
 *
 * @internal
 */
export function RebaseI18nProvider({
    locale = "en",
    translations,
    children
}: PropsWithChildren<RebaseI18nProviderProps>) {
    const i18nRef = useRef<i18n | null>(null);
    const [ready, setReady] = React.useState(false);
    // The language the `locale` prop is switching to, while it does. That
    // change is the app's, not the user's, and must not be stored as their
    // preference — once stored, the prop is ignored for good.
    const propLanguageRef = useRef<string | null>(null);
    // The overrides the backend merges into a table it loads later. A ref,
    // not a closure over the first render's prop, so a language fetched after
    // the prop changed still gets the current overrides.
    const translationsRef = useRef(translations);
    translationsRef.current = translations;
    // The overrides the instance was built with — the effect below skips them
    // rather than merging every table a second time on mount.
    const appliedTranslationsRef = useRef<string | null>(null);

    if (!i18nRef.current) {
        const instance = i18next.createInstance();

        let initialLocale = locale;
        const stored = readStoredString(REBASE_LOCALE_STORAGE_KEY);
        if (stored) initialLocale = stored;
        // The first language is the prop's (or the stored one), not a choice
        // the user made now. A language that has to be fetched announces
        // itself after the listener below is attached, and was stored as the
        // user's preference — after which the prop was ignored for good.
        else propLanguageRef.current = initialLocale;

        appliedTranslationsRef.current = serializeTranslations(translations);

        instance
            .use(createLocaleBackend(() => translationsRef.current))
            .use(initReactI18next)
            .init({
                lng: initialLocale,
                fallbackLng: "en",
                ns: [REBASE_NS],
                defaultNS: REBASE_NS,
                // English and any language Rebase does not ship are in from
                // the start; a shipped one is asked of the backend above.
                resources: buildInitialResources(translations),
                partialBundledLanguages: true,
                interpolation: {
                    // React already escapes — don't double-escape
                    escapeValue: false
                }
            }, () => {
                // Synchronous for English (nothing to fetch), so it renders
                // on the first pass as before; for another language this runs
                // once its table is in, and nothing renders until then.
                setReady(true);
            });

        instance.on("languageChanged", (lng) => {
            const fromProp = propLanguageRef.current === lng;
            propLanguageRef.current = null;
            if (fromProp) return;
            if (typeof window !== "undefined") {
                writeStoredString(REBASE_LOCALE_STORAGE_KEY, lng);
            }
        });

        i18nRef.current = instance;
    }

    // When `locale` prop changes, switch language on the existing instance
    // ONLY if the user hasn't explicitly set a preference
    useEffect(() => {
        if (i18nRef.current && i18nRef.current.language !== locale) {
            const hasUserPreference = Boolean(readStoredString(REBASE_LOCALE_STORAGE_KEY));
            if (!hasUserPreference) {
                propLanguageRef.current = locale;
                i18nRef.current.changeLanguage(locale);
            }
        }
    }, [locale]);

    // When consumer translations prop changes, update the resource bundles.
    // Keyed on the content, not the object: an inline `translations={{…}}`
    // is a new object on every render of the app.
    const translationsKey = serializeTranslations(translations);
    useEffect(() => {
        const instance = i18nRef.current;
        if (!instance) return;
        if (translationsKey === appliedTranslationsRef.current) return;
        appliedTranslationsRef.current = translationsKey;
        const overrides = translationsRef.current ?? {};
        const languages = new Set([...Object.keys(loadedTables), ...Object.keys(overrides)]);
        for (const lang of languages) {
            const table = loadedTables[lang];
            // A shipped table not fetched yet: leave it to the backend, which
            // merges the current overrides when it loads. Adding a bundle here
            // would make i18next think it is loaded and never fetch it.
            if (!table && LOCALE_LOADERS[lang]) continue;
            if (table && lang !== "en" && !instance.hasResourceBundle(lang, REBASE_NS)) continue;
            instance.addResourceBundle(
                lang,
                REBASE_NS,
                { ...(table ?? en), ...overrides[lang] },
                true, // deep merge
                true // overwrite existing keys
            );
        }
    }, [translationsKey]);

    if (!ready || !i18nRef.current) return null;

    return (
        <I18nextProvider i18n={i18nRef.current}>
            <UiLabelsFromTranslations>
                {children}
            </UiLabelsFromTranslations>
        </I18nextProvider>
    );
}

type TranslationOverrides = { [locale: string]: DeepPartial<RebaseTranslations> };

function serializeTranslations(translations?: TranslationOverrides): string {
    return translations ? JSON.stringify(translations) : "";
}

/**
 * The resources i18next starts with: English, plus every language the
 * consumer adds that Rebase does not ship (it starts from English, then the
 * overrides). A shipped language is left out — the backend fetches it and
 * merges its overrides then; an override added here first would be
 * overwritten by the table, or stop the table from ever loading.
 */
function buildInitialResources(translations?: TranslationOverrides): Record<string, Record<string, object>> {
    const resources: Record<string, Record<string, object>> = {
        en: { [REBASE_NS]: { ...en, ...translations?.en } }
    };
    for (const [lang, overrides] of Object.entries(translations ?? {})) {
        if (lang === "en" || LOCALE_LOADERS[lang]) continue;
        resources[lang] = { [REBASE_NS]: { ...en, ...overrides } };
    }
    return resources;
}

/**
 * An i18next backend over {@link LOCALE_LOADERS}. i18next asks it for a
 * language it has no bundle for, and `changeLanguage` (and `init`) wait for
 * the answer before switching — which is what keeps a half-loaded language
 * off the screen.
 *
 * A language Rebase does not ship answers with an empty table, synchronously,
 * so keys fall back to English at once. A chunk that fails to load (a deploy
 * replaced it under an open tab, say) is retried once by `loadChunk`; after
 * that i18next switches anyway and English fills in.
 */
function createLocaleBackend(getOverrides: () => TranslationOverrides | undefined): BackendModule {
    return {
        type: "backend",
        init() {
            // nothing to configure
        },
        read(language, namespace, callback) {
            if (namespace !== REBASE_NS) {
                callback(null, {});
                return;
            }
            const cached = loadedTables[language];
            if (cached) {
                callback(null, { ...cached, ...getOverrides()?.[language] });
                return;
            }
            const loader = LOCALE_LOADERS[language];
            if (!loader) {
                callback(null, { ...getOverrides()?.[language] });
                return;
            }
            loadChunk(loader).then(
                table => {
                    loadedTables[language] = table;
                    callback(null, { ...table, ...getOverrides()?.[language] });
                },
                (error: unknown) => callback(error instanceof Error ? error : String(error), null)
            );
        }
    };
}

/**
 * The UI kit's own words (`@rebasepro/ui`'s list and card notices, the table's
 * error title, the search bar's names, relative dates) in the admin language.
 * The kit speaks English on its own; this fills its labels from the
 * translations, and refills them when the language changes.
 */
function UiLabelsFromTranslations({ children }: PropsWithChildren) {
    // `t` changes identity with the language, so the labels follow it.
    const { t } = useTranslation();
    const labels = useMemo((): UiLabelsProviderProps["labels"] => ({
        errorLoadingData: (message) => t("error_loading_data_message", { message }),
        noEntriesFound: t("no_entries_found"),
        allEntriesLoaded: (count) => t("all_entries_loaded", { count }),
        error: t("error"),
        search: t("search"),
        clearSearch: t("clear_search"),
        select: t("select"),
        relativeTime: {
            justNow: t("relative_just_now"),
            inAMoment: t("relative_in_a_moment"),
            minutesAgo: (count) => t("relative_minutes_ago", { count }),
            inMinutes: (count) => t("relative_in_minutes", { count }),
            hoursAgo: (count) => t("relative_hours_ago", { count }),
            inHours: (count) => t("relative_in_hours", { count }),
            daysAgo: (count) => t("relative_days_ago", { count }),
            inDays: (count) => t("relative_in_days", { count })
        }
    }), [t]);
    return <UiLabelsProvider labels={labels}>{children}</UiLabelsProvider>;
}
