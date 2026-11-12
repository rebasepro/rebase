// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import filmCollection from "./film";

// Introspected as a lookup: a 6-row code list: referenced by 2 table(s), references none, 3 or fewer simple columns.

const languageCollection = defineCollection({
    name: "Language",
    singularName: "Language",
    slug: "language",
    table: "language",
    properties: {
        languageId: {
            name: "Language Id",
            columnName: "language_id",
            type: "number",
            isId: "manual",
            columnType: "serial",
        },
        name: {
            name: "Name",
            columnName: "name",
            type: "string",
            admin: {
                multiline: true
            },
            validation: {
                required: true
            },
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
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "film",
            target: (): AnyCollectionConfig => filmCollection,
            // the film.language_id FK points back here
            foreignKeyOnTarget: "language_id"
        },
        {
            kind: "hasMany",
            relationName: "film_by_original_language_id",
            target: (): AnyCollectionConfig => filmCollection,
            // the film.original_language_id FK points back here
            foreignKeyOnTarget: "original_language_id"
        },
    ],
    admin: {
        icon: "Database",
        group: "Reference",
        display: { title: "name" },
        sort: ["lastUpdate", "desc"],
        propertiesOrder: [
            "languageId",
            "name",
            "lastUpdate"
        ]
    }
});

export default languageCollection;
