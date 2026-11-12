// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import trackCollection from "./track";

// Introspected as a lookup: a 25-row code list: referenced by 1 table(s), references none, 3 or fewer simple columns.

const genreCollection = defineCollection({
    name: "Genre",
    singularName: "Genre",
    slug: "genre",
    table: "genre",
    properties: {
        genreId: {
            name: "Genre Id",
            columnName: "genre_id",
            type: "number",
            isId: "manual",
            columnType: "integer",
        },
        name: {
            name: "Name",
            columnName: "name",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 120
            },
        },
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "track",
            target: (): AnyCollectionConfig => trackCollection,
            // the track.genre_id FK points back here
            foreignKeyOnTarget: "genre_id"
        },
    ],
    admin: {
        icon: "Database",
        group: "Reference",
        propertiesOrder: [
            "genreId",
            "name"
        ]
    }
});

export default genreCollection;
