// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import filmCollection from "./film";
import storeCollection from "./store";
import rentalCollection from "./rental";

const inventoryCollection = defineCollection({
    name: "Inventory",
    singularName: "Inventory",
    slug: "inventory",
    table: "inventory",
    properties: {
        inventoryId: {
            name: "Inventory Id",
            columnName: "inventory_id",
            type: "number",
            isId: "manual",
            columnType: "serial",
        },
        lastUpdate: {
            name: "Last Update",
            columnName: "last_update",
            type: "date",
            autoValue: "on_create",
            admin: {
                readOnly: true
            },
            validation: {
                required: true
            },
        },
        film: {
            name: "Film",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: film_id -> film(film_id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => filmCollection,
                localKey: "film_id"
            }
        },
        store: {
            name: "Store",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: store_id -> store(store_id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => storeCollection,
                localKey: "store_id"
            }
        },
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "rental",
            target: (): AnyCollectionConfig => rentalCollection,
            // the rental.inventory_id FK points back here
            foreignKeyOnTarget: "inventory_id"
        },
    ],
    admin: {
        icon: "Database",
        sort: ["lastUpdate", "desc"],
        propertiesOrder: [
            "inventoryId",
            "lastUpdate",
            "film",
            "store"
        ]
    }
});

export default inventoryCollection;
