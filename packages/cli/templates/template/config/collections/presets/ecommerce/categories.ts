import { CollectionConfig } from "@rebasepro/types";

const categoriesCollection: CollectionConfig = {
    name: "Categories",
    singularName: "Category",
    slug: "categories",
    table: "categories",
    icon: "Category",
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
            ui: {
                multiline: true
            }
        },
        icon: {
            name: "Icon",
            type: "string"
        }
    },
    propertiesOrder: ["id", "name", "slug", "description", "icon"]
};

export default categoriesCollection;
