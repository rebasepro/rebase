// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import productsCollection from "./products";

const categoriesCollection = defineCollection({
    name: "Categories",
    singularName: "Category",
    slug: "categories",
    table: "categories",
    properties: {
        categoryId: {
            name: "Category Id",
            columnName: "category_id",
            type: "number",
            isId: "manual",
        },
        categoryName: {
            name: "Category Name",
            columnName: "category_name",
            type: "string",
            columnType: "varchar",
            validation: {
                required: true,
                max: 15
            },
        },
        description: {
            name: "Description",
            columnName: "description",
            type: "string",
            admin: {
                multiline: true
            },
        },
        picture: {
            name: "Picture",
            columnName: "picture",
            type: "binary",
        },
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "products",
            target: (): AnyCollectionConfig => productsCollection,
            // the products.category_id FK points back here
            foreignKeyOnTarget: "category_id"
        },
    ],
    admin: {
        icon: "Tag",
        display: { title: "categoryName" },
        propertiesOrder: [
            "categoryId",
            "categoryName",
            "description",
            "picture"
        ]
    }
});

export default categoriesCollection;
