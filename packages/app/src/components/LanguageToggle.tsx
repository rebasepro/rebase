import React from "react";
import { CheckIcon, IconButton, iconSize, LanguagesIcon, Menu, MenuItem, Typography } from "@rebasepro/ui";
import { useTranslation } from "../hooks";
import { useRebaseLocales } from "../i18n/RebaseI18nProvider";

/** The shipped languages, each named in itself. */
const LANGUAGE_NAMES: Record<string, string> = {
    en: "English",
    es: "Español",
    de: "Deutsch",
    fr: "Français",
    it: "Italiano",
    hi: "हिन्दी",
    pt: "Português"
};

/**
 * A language's name in that language. One Rebase does not ship is named by
 * the browser (`nl` → "Nederlands"), and by its code when the browser cannot.
 */
export function languageName(locale: string): string {
    const known = LANGUAGE_NAMES[locale];
    if (known) return known;
    try {
        const name = new Intl.DisplayNames([locale], { type: "language" }).of(locale);
        if (name && name !== locale) return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
    } catch {
        // not a valid language tag
    }
    return locale;
}

/**
 * The language menu: every language the admin can be shown in, which is the
 * shipped ones plus any the app adds through `<Rebase translations>`.
 */
export function LanguageToggle() {
    const { t, i18n } = useTranslation();
    const locales = useRebaseLocales();

    return (
        <Menu
            trigger={<IconButton
                aria-label={t("change_language")}>
                <LanguagesIcon size={iconSize.small}/>
            </IconButton>}>
            {locales.map(locale => (
                <MenuItem key={locale} onClick={() => i18n.changeLanguage(locale)}>
                    <div className="flex w-full items-center justify-between gap-4">
                        <Typography variant="body2" className={i18n.language === locale ? "font-semibold" : ""}>
                            {languageName(locale)}
                        </Typography>
                        {i18n.language === locale && <CheckIcon size={iconSize.small}/>}
                    </div>
                </MenuItem>
            ))}
        </Menu>
    );
}
