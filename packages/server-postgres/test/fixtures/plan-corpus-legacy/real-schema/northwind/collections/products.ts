// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import categoriesCollection from "./categories";
import suppliersCollection from "./suppliers";
import orderDetailsCollection from "./order_details";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "units_in_stock" is smallint, which no `columnType` names; it is declared integer, so a push widens it (every value survives).
//   - "units_on_order" is smallint, which no `columnType` names; it is declared integer, so a push widens it (every value survives).
//   - "reorder_level" is smallint, which no `columnType` names; it is declared integer, so a push widens it (every value survives).

const productsCollection = defineCollection({
    name: "Products",
    singularName: "Product",
    slug: "products",
    table: "products",
    properties: {
        productId: {
            name: "Product Id",
            columnName: "product_id",
            type: "number",
            isId: "manual",
        },
        productName: {
            name: "Product Name",
            columnName: "product_name",
            type: "string",
            columnType: "varchar",
            validation: {
                required: true,
                max: 40
            },
        },
        category: {
            name: "Category",
            type: "relation",
            // mapped from foreign key: category_id -> categories(category_id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => categoriesCollection,
                localKey: "category_id",
                onDelete: "no action"
            }
        },
        quantityPerUnit: {
            name: "Quantity Per Unit",
            columnName: "quantity_per_unit",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 20
            },
        },
        unitPrice: {
            name: "Unit Price",
            columnName: "unit_price",
            type: "number",
            columnType: "real",
        },
        unitsInStock: {
            name: "Units In Stock",
            columnName: "units_in_stock",
            type: "number",
            columnType: "integer",
        },
        unitsOnOrder: {
            name: "Units On Order",
            columnName: "units_on_order",
            type: "number",
            columnType: "integer",
        },
        reorderLevel: {
            name: "Reorder Level",
            columnName: "reorder_level",
            type: "number",
            columnType: "integer",
        },
        discontinued: {
            name: "Discontinued",
            columnName: "discontinued",
            type: "number",
            columnType: "integer",
            validation: {
                required: true
            },
        },
        supplier: {
            name: "Supplier",
            type: "relation",
            // mapped from foreign key: supplier_id -> suppliers(supplier_id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => suppliersCollection,
                localKey: "supplier_id",
                onDelete: "no action"
            }
        },
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "order_details",
            target: (): AnyCollectionConfig => orderDetailsCollection,
            // the order_details.product_id FK points back here
            foreignKeyOnTarget: "product_id"
        },
    ],
    admin: {
        icon: "Package",
        display: { title: "productName" },
        listProperties: [
            "productId",
            "productName",
            "category",
            "quantityPerUnit",
            "unitPrice",
            "unitsInStock"
        ],
        propertiesOrder: [
            "productId",
            "productName",
            "category",
            "quantityPerUnit",
            "unitPrice",
            "unitsInStock",
            "unitsOnOrder",
            "reorderLevel",
            "discontinued",
            "supplier"
        ]
    }
});

export default productsCollection;
