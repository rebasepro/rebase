import { customizeTable } from "@rebasepro/cms";
import type { productLocales } from "../../../backend/schema/product_locales";
import { LOCALE_LABELS } from "./lib/locales";

export const productLocalesCms = customizeTable<typeof productLocales>("product_locales", {
    icon: "Translate",
    group: "E-Commerce",
    hideFromNavigation: true,
    display: {
        title: ({ row }) => [row.locale, row.name]
            .filter(Boolean).join(" — ") || undefined,
        subtitle: "description",
        status: "locale"
    },
    fields: {
        locale: {
            enumLabels: LOCALE_LABELS
        },
        description: {
            markdown: true
        }
    }
});
