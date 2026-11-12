// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import countryCollection from "./country";
import addressCollection from "./address";

const cityCollection = defineCollection({
    name: "City",
    singularName: "City",
    slug: "city",
    table: "city",
    properties: {
        cityId: {
            name: "City Id",
            columnName: "city_id",
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
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: country_id -> country(country_id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => countryCollection,
                localKey: "country_id"
            }
        },
        city: {
            name: "City",
            columnName: "city",
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
            relationName: "address",
            target: (): AnyCollectionConfig => addressCollection,
            // the address.city_id FK points back here
            foreignKeyOnTarget: "city_id"
        },
    ],
    admin: {
        icon: "Database",
        display: { title: "city" },
        sort: ["lastUpdate", "desc"],
        propertiesOrder: [
            "cityId",
            "lastUpdate",
            "country",
            "city"
        ]
    }
});

export default cityCollection;
