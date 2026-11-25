import React, { createContext, PropsWithChildren, useContext, useEffect, useMemo, useRef } from "react";
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
const LOCALE_LOADERS: Partial<Record<string, () => Promise<RebaseTranslations>>> = {
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

/**
 * Every language the admin can be shown in: English, the ones Rebase ships,
 * and any the app adds through `translations` — a language Rebase does not
 * ship is a full table from the app, falling back to English key by key.
 */
export function availableRebaseLocales(translatedLocales: readonly string[] = []): string[] {
    return [...new Set(["en", ...Object.keys(LOCALE_LOADERS), ...translatedLocales])];
}

const RebaseLocalesContext = createContext<string[]>(availableRebaseLocales());

/**
 * The languages the admin can be switched to — what the language menu lists.
 * Outside a {@link RebaseI18nProvider}, the ones Rebase ships.
 */
export function useRebaseLocales(): string[] {
    return useContext(RebaseLocalesContext);
}

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
     * A locale's table can be a loader instead — `() => import("./es")…` —
     * fetched the first time that language is shown, like the ones Rebase
     * ships. Only the language on screen (and English, the fallback) is then
     * downloaded and parsed before the first paint.
     *
     * @example
     * translations={{
     *   en: { save: "Publish" },
     *   es: () => import("./locales/es").then(m => m.es)
     * }}
     */
    translations?: TranslationOverrides;
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
        // English is never fetched by the backend — it is the fallback, in
        // from the start — so an English table given as a loader is merged in
        // when it arrives.
        const englishOverrides = overridesFor(translations, "en");
        if (englishOverrides instanceof Promise) {
            englishOverrides.then(
                table => instance.addResourceBundle("en", REBASE_NS, table ?? {}, true, true),
                () => { /* English as shipped */ }
            );
        }

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
                // Re-render on a bundle added to the language on screen: an
                // English table given as a loader, or overrides that changed.
                // react-i18next listens for language changes only by default,
                // and those updates landed in the store with nothing redrawn.
                react: { bindI18nStore: "added" },
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
    // Memoized on the object, so an app passing a module-level table (most
    // do) does not have it serialized on every render of the tree.
    const translationsKey = useMemo(() => serializeTranslations(translations), [translations]);
    useEffect(() => {
        const instance = i18nRef.current;
        if (!instance) return;
        if (translationsKey === appliedTranslationsRef.current) return;
        appliedTranslationsRef.current = translationsKey;
        const current = translationsRef.current;
        const languages = new Set([...Object.keys(loadedTables), ...Object.keys(current ?? {})]);
        for (const lang of languages) {
            const table = loadedTables[lang];
            // A shipped table not fetched yet: leave it to the backend, which
            // merges the current overrides when it loads. Adding a bundle here
            // would make i18next think it is loaded and never fetch it.
            if (!table && LOCALE_LOADERS[lang]) continue;
            if (table && lang !== "en" && !instance.hasResourceBundle(lang, REBASE_NS)) continue;
            // The same for a language only the app has, given as a loader.
            if (!table && typeof current?.[lang] === "function" && !instance.hasResourceBundle(lang, REBASE_NS)) continue;
            const apply = (overrides: TranslationTable | undefined) => instance.addResourceBundle(
                lang,
                REBASE_NS,
                { ...(table ?? en), ...overrides },
                true, // deep merge
                true // overwrite existing keys
            );
            const overrides = overridesFor(current, lang);
            if (overrides instanceof Promise) overrides.then(apply, () => { /* keep what is there */ });
            else apply(overrides);
        }
    }, [translationsKey]);

    // Keyed on the names, not the object, for the same reason as above.
    const localeNames = Object.keys(translations ?? {}).join(",");
    const locales = useMemo(
        () => availableRebaseLocales(localeNames ? localeNames.split(",") : []),
        [localeNames]
    );

    if (!ready || !i18nRef.current) return null;

    return (
        <I18nextProvider i18n={i18nRef.current}>
            <RebaseLocalesContext.Provider value={locales}>
                <UiLabelsFromTranslations>
                    {children}
                </UiLabelsFromTranslations>
            </RebaseLocalesContext.Provider>
        </I18nextProvider>
    );
}

type TranslationTable = DeepPartial<RebaseTranslations>;
type TranslationLoader = () => Promise<TranslationTable>;
type TranslationOverrides = { [locale: string]: TranslationTable | TranslationLoader };

/**
 * A loader stands for itself by a token, not by identity: an inline
 * `es: () => import(…)` is a new function on every render, and the effect
 * that re-merges tables must not run for that. The backend reads the current
 * loader from the ref, and the browser caches the module it imports.
 */
function serializeTranslations(translations?: TranslationOverrides): string {
    return translations
        ? JSON.stringify(translations, (_key, value: unknown) => typeof value === "function" ? "\u0192" : value)
        : "";
}

/** Tables the app's loaders resolved to, by loader. */
const resolvedLoaders = new WeakMap<TranslationLoader, TranslationTable>();

/**
 * The app's overrides for a language: the table itself, or — for a loader —
 * the table it resolved to, or a promise of it the first time.
 */
function overridesFor(
    translations: TranslationOverrides | undefined,
    language: string
): TranslationTable | undefined | Promise<TranslationTable> {
    const entry = translations?.[language];
    if (typeof entry !== "function") return entry;
    const resolved = resolvedLoaders.get(entry);
    if (resolved) return resolved;
    return loadChunk(entry).then(table => {
        resolvedLoaders.set(entry, table);
        return table;
    });
}

/** The overrides for a language if they are in hand — a loader not resolved yet has none. */
function overridesNow(translations: TranslationOverrides | undefined, language: string): TranslationTable | undefined {
    const overrides = overridesFor(translations, language);
    if (overrides instanceof Promise) {
        // Started, not awaited: the caller cannot wait. Swallowed here; the
        // promise's own consumer, if any, sees the failure.
        overrides.catch(() => undefined);
        return undefined;
    }
    return overrides;
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
        en: { [REBASE_NS]: { ...en, ...overridesNow(translations, "en") } }
    };
    for (const [lang, overrides] of Object.entries(translations ?? {})) {
        if (lang === "en" || LOCALE_LOADERS[lang]) continue;
        // A loader is the backend's to call, when the language is shown.
        if (typeof overrides === "function") continue;
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
            const loader = LOCALE_LOADERS[language];
            // Rebase's table: in hand, to fetch, or none (a language only the
            // app has, which falls back to English key by key).
            const table: RebaseTranslations | Record<string, never> | undefined = loadedTables[language] ?? (loader ? undefined : {});
            const overrides = overridesFor(getOverrides(), language);
            // Both in hand: answer synchronously, so the language switches on
            // the same pass.
            if (table && !(overrides instanceof Promise)) {
                callback(null, { ...table, ...overrides });
                return;
            }
            Promise.all([
                table ?? (loader ? loadChunk(loader).then(loaded => {
                    loadedTables[language] = loaded;
                    return loaded;
                }) : {}),
                // An app table that fails to load leaves Rebase's own.
                Promise.resolve(overrides).catch(() => undefined)
            ]).then(
                ([loaded, appTable]) => callback(null, { ...loaded, ...appTable }),
                (error: unknown) => callback(error instanceof Error ? error : String(error), null)
            );
        }
    };
}

/**
 * The UI kit's own words (`@rebasepro/ui`'s list and card notices, the table's
 * error title, the search bar's names, the split view's back button and
 * divider, relative dates, the metric blocks' phrases and the language they
 * write numbers in) in the admin language.
 * The kit speaks English on its own; this fills its labels from the
 * translations, and refills them when the language changes.
 */
function UiLabelsFromTranslations({ children }: PropsWithChildren) {
    // `t` changes identity with the language, so the labels follow it.
    const { t, i18n: instance } = useTranslation();
    const language = instance.language;
    const labels = useMemo((): UiLabelsProviderProps["labels"] => ({
        errorLoadingData: (message) => t("error_loading_data_message", { message }),
        noEntriesFound: t("no_entries_found"),
        allEntriesLoaded: (count) => t("all_entries_loaded", { count }),
        error: t("error"),
        search: t("search"),
        clearSearch: t("clear_search"),
        select: t("select"),
        openTimePicker: t("open_time_picker"),
        back: t("back"),
        resizeList: t("resize_list"),
        changeUp: (change) => t("insights_change_up", { change }),
        changeDown: (change) => t("insights_change_down", { change }),
        noChange: t("insights_change_none"),
        previousPeriodValue: (days, value) => t("insights_previous_period_value", { count: days, value }),
        lastDays: (days) => t("insights_period_last_days", { count: days }),
        noData: t("insights_no_data"),
        nothingRecorded: t("insights_nothing_recorded"),
        date: t("date"),
        locale: language,
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
    }), [t, language]);
    return <UiLabelsProvider labels={labels}>{children}</UiLabelsProvider>;
}
