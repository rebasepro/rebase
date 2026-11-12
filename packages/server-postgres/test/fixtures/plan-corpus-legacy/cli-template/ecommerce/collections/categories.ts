// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";

const categoriesCollection = defineCollection({
    name: "Categories",
    singularName: "Category",
    slug: "categories",
    table: "categories",
    properties: {
        id: {
            name: "ID",
            type: "number",
            isId: "increment"
        },
        name: {
            name: "Name",
            type: "string",
            validation: { required: true }
        },
        slug: {
            name: "Slug",
            type: "string",
            validation: { required: true }
        },
        description: {
            name: "Description",
            type: "string",
            admin: {
                multiline: true
            }
        },
        icon: {
            name: "Icon",
            type: "string"
        }
    },
    admin: {
        icon: "Category",
        propertiesOrder: ["id", "name", "slug", "description", "icon"]
    }
});

export default categoriesCollection;
