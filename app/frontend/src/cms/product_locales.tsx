import { customizeTable } from "@rebasepro/cms";
import type { productLocales } from "../../../backend/schema/product_locales";

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
            enumLabels: {
                en: "English",
                es: "Spanish",
                fr: "French",
                de: "German",
                it: "Italian"
            }
        },
        description: {
            markdown: true
        }
    }
});
