// Mutually recursive by design; the reference is only dereferenced inside the
// `target: () =>` thunk below, so module init order never matters.
// fallow-ignore-next-line circular-dependency
import productsCollection from "./products";
import { LOCALE_ENUM } from "../locales";
import { defineCollection } from "@rebasepro/cms-types";
import type { PostgresCollectionConfig } from "@rebasepro/types";

const productLocalesCollection = defineCollection({
    name: "Product Locales",
    singularName: "Product Locale",
    slug: "product_locales",
    table: "product_locales",
    history: true,
    properties: {
        id: {
            name: "ID",
            type: "string",
            isId: "uuid",
            validation: {
                required: true
            }
        },
        product: {
            name: "Product",
            type: "relation",
            relation: {
                kind: "belongsTo",
                target: (): PostgresCollectionConfig => productsCollection,
            }
        },
        locale: {
            name: "Locale",
            type: "string",
            enum: LOCALE_ENUM,
            validation: {
                required: true
            }
        },
        name: {
            name: "Name",
            type: "string"
        },
        description: {
            name: "Description",
            type: "string",
            admin: { markdown: true }
        }
    },
    admin: {
        icon: "Translate",
        group: "E-Commerce",
        // Not a drawer destination, but very much a tab on the product it
        // translates — the two halves are separate flags now, so this says only
        // the first one.
        hideFromNavigation: true,
        // Every row here is called "Name", because that is what the translated
        // field is called. What tells two of them apart is the locale, so the
        // locale leads.
        display: {
            title: ({ entity }) => [entity.values.locale, entity.values.name]
                .filter(Boolean).join(" — ") || undefined,
            subtitle: "description",
            status: "locale"
        }
    }
});


export default productLocalesCollection;
