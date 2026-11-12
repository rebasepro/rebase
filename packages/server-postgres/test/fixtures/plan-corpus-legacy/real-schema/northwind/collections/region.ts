// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import territoriesCollection from "./territories";

// Introspected as a lookup: a 4-row code list: referenced by 1 table(s), references none, 3 or fewer simple columns.

const regionCollection = defineCollection({
    name: "Region",
    singularName: "Region",
    slug: "region",
    table: "region",
    properties: {
        regionId: {
            name: "Region Id",
            columnName: "region_id",
            type: "number",
            isId: "manual",
        },
        regionDescription: {
            name: "Region Description",
            columnName: "region_description",
            type: "string",
            columnType: "varchar",
            validation: {
                required: true,
                max: 60
            },
        },
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "territories",
            target: (): AnyCollectionConfig => territoriesCollection,
            // the territories.region_id FK points back here
            foreignKeyOnTarget: "region_id"
        },
    ],
    admin: {
        icon: "Database",
        group: "Reference",
        display: { title: "regionDescription" },
        propertiesOrder: [
            "regionId",
            "regionDescription"
        ]
    }
});

export default regionCollection;
