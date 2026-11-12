// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import albumCollection from "./album";

const artistCollection = defineCollection({
    name: "Artist",
    singularName: "Artist",
    slug: "artist",
    table: "artist",
    properties: {
        artistId: {
            name: "Artist Id",
            columnName: "artist_id",
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
            relationName: "album",
            target: (): AnyCollectionConfig => albumCollection,
            // the album.artist_id FK points back here
            foreignKeyOnTarget: "artist_id"
        },
    ],
    admin: {
        icon: "Database",
        propertiesOrder: [
            "artistId",
            "name"
        ]
    }
});

export default artistCollection;
