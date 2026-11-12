// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import categoriesCollection from "./categories";

const productsCollection = defineCollection({
    name: "Products",
    singularName: "Product",
    slug: "products",
    table: "products",
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
            admin: {
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
                {
                    id: "draft",
                    label: "Draft",
                    color: "gray"
                },
                {
                    id: "active",
                    label: "Active",
                    color: "green"
                },
                {
                    id: "archived",
                    label: "Archived",
                    color: "orange"
                }
            ]
        },
        category: {
            name: "Category",
            type: "relation",
            relation: {
                kind: "belongsTo",
                target: () => categoriesCollection,
                relationName: "category",
            }
        }
    },
    admin: {
        icon: "ShoppingCart"
    }
});

export default productsCollection;
