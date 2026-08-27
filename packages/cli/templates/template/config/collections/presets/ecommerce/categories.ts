import { defineCollection } from "@rebasepro/cms-types";

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
