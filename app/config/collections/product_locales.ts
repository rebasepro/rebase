import { defineCollection } from "@rebasepro/common";
import productsCollection from "./products";

const productLocalesCollection = defineCollection({
    name: "Product Locales",
    singularName: "Product Locale",
    slug: "product_locales",
    table: "product_locales",
    icon: "Translate",
    group: "E-Commerce",
    history: true,
    hideFromNavigation: true,
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
    // Demo: anyone can read; only admins can write.
    securityRules: [
        { operation: "select",
access: "public" },
        { operations: ["insert", "update", "delete"],
roles: ["admin"] }
    ],
});


export default productLocalesCollection;
