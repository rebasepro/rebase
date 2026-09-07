import React from "react";
import { CheckIcon, IconButton, iconSize, LanguagesIcon, Menu, MenuItem, Typography } from "@rebasepro/ui";
import { useTranslation } from "../hooks";

export function LanguageToggle() {
    const { t, i18n } = useTranslation();

    return (
        <Menu
            trigger={<IconButton
                color="inherit"
                aria-label={t("change_language")}>
                <LanguagesIcon size={iconSize.small}/>
            </IconButton>}>
            <MenuItem onClick={() => i18n.changeLanguage("en")}>
                <div className="flex w-full items-center justify-between gap-4">
                    <Typography variant="body2" className={i18n.language === "en" ? "font-semibold" : ""}>English</Typography>
                    {i18n.language === "en" && <CheckIcon size={iconSize.small}/>}
                </div>
            </MenuItem>
            <MenuItem onClick={() => i18n.changeLanguage("es")}>
                <div className="flex w-full items-center justify-between gap-4">
                    <Typography variant="body2" className={i18n.language === "es" ? "font-semibold" : ""}>Español</Typography>
                    {i18n.language === "es" && <CheckIcon size={iconSize.small}/>}
                </div>
            </MenuItem>
            <MenuItem onClick={() => i18n.changeLanguage("de")}>
                <div className="flex w-full items-center justify-between gap-4">
                    <Typography variant="body2" className={i18n.language === "de" ? "font-semibold" : ""}>Deutsch</Typography>
                    {i18n.language === "de" && <CheckIcon size={iconSize.small}/>}
                </div>
            </MenuItem>
            <MenuItem onClick={() => i18n.changeLanguage("fr")}>
                <div className="flex w-full items-center justify-between gap-4">
                    <Typography variant="body2" className={i18n.language === "fr" ? "font-semibold" : ""}>Français</Typography>
                    {i18n.language === "fr" && <CheckIcon size={iconSize.small}/>}
                </div>
            </MenuItem>
            <MenuItem onClick={() => i18n.changeLanguage("it")}>
                <div className="flex w-full items-center justify-between gap-4">
                    <Typography variant="body2" className={i18n.language === "it" ? "font-semibold" : ""}>Italiano</Typography>
                    {i18n.language === "it" && <CheckIcon size={iconSize.small}/>}
                </div>
            </MenuItem>
            <MenuItem onClick={() => i18n.changeLanguage("hi")}>
                <div className="flex w-full items-center justify-between gap-4">
                    <Typography variant="body2" className={i18n.language === "hi" ? "font-semibold" : ""}>हिन्दी</Typography>
                    {i18n.language === "hi" && <CheckIcon size={iconSize.small}/>}
                </div>
            </MenuItem>
            <MenuItem onClick={() => i18n.changeLanguage("pt")}>
                <div className="flex w-full items-center justify-between gap-4">
                    <Typography variant="body2" className={i18n.language === "pt" ? "font-semibold" : ""}>Português</Typography>
                    {i18n.language === "pt" && <CheckIcon size={iconSize.small}/>}
                </div>
            </MenuItem>
        </Menu>
    );
}
