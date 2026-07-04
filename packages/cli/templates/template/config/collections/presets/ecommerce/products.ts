import { CollectionConfig } from "@rebasepro/types";
import categoriesCollection from "./categories.js";

const productsCollection: CollectionConfig = {
    name: "Products",
    singularName: "Product",
    slug: "products",
    table: "products",
    icon: "ShoppingCart",
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
        description: {
            name: "Description",
            type: "string",
            ui: {
                markdown: true
            }
        },
        price: {
            name: "Price",
            type: "number",
            validation: { required: true }
        },
        image: {
            name: "Image",
            type: "string",
            storage: { storagePath: "product_images/" }
        },
        status: {
            name: "Status",
            type: "string",
            enum: [
                { id: "draft",
label: "Draft",
color: "gray" },
                { id: "active",
label: "Active",
color: "green" },
                { id: "archived",
label: "Archived",
color: "orange" }
            ]
        },
        category: {
            name: "Category",
            type: "relation",
            relationName: "category",
            target: () => categoriesCollection,
            cardinality: "one",
            direction: "owning"
        }
    }
};

export default productsCollection;
