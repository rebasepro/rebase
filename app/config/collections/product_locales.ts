import { defineCollection } from "@rebasepro/common";
// Mutually recursive by design; the reference is only dereferenced inside the
// `target: () =>` thunk below, so module init order never matters.
// fallow-ignore-next-line circular-dependency
import productsCollection from "./products";

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
            target: () => productsCollection,
            cardinality: "one",
            direction: "owning"
        },
        locale: {
            name: "Locale",
            type: "string",
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
            ui: { markdown: true }
        }
    },
    admin: {
        icon: "Translate",
        group: "E-Commerce",
        hideFromNavigation: true
    }
});


export default productLocalesCollection;
