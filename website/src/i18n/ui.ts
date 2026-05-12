import { en } from "./en";
import { es } from "./es";
import { de } from "./de";
import { fr } from "./fr";

export const languages = {
  en: "English",
  es: "Español",
  de: "Deutsch",
  fr: "Français",
};

export const defaultLang = "en";

export const ui = {
  en,
  es,
  de,
  fr,
} as const;

export * from "./utils";
