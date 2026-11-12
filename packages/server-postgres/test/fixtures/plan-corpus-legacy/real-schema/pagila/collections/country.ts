// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import cityCollection from "./city";

const countryCollection = defineCollection({
    name: "Country",
    singularName: "Country",
    slug: "country",
    table: "country",
    properties: {
        countryId: {
            name: "Country Id",
            columnName: "country_id",
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
        country: {
            name: "Country",
            columnName: "country",
            type: "string",
            admin: {
                multiline: true
            },
            validation: {
                required: true
            },
        },
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "city",
            target: (): AnyCollectionConfig => cityCollection,
            // the city.country_id FK points back here
            foreignKeyOnTarget: "country_id"
        },
    ],
    admin: {
        icon: "Database",
        display: { title: "country" },
        sort: ["lastUpdate", "desc"],
        propertiesOrder: [
            "countryId",
            "lastUpdate",
            "country"
        ]
    }
});

export default countryCollection;
