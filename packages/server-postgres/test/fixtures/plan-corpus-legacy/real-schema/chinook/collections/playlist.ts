// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import trackCollection from "./track";

// Introspected as a lookup: a 18-row code list: referenced by 1 table(s), references none, 3 or fewer simple columns.

const playlistCollection = defineCollection({
    name: "Playlist",
    singularName: "Playlist",
    slug: "playlist",
    table: "playlist",
    properties: {
        playlistId: {
            name: "Playlist Id",
            columnName: "playlist_id",
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
            kind: "manyToMany",
            relationName: "track",
            target: (): AnyCollectionConfig => trackCollection,
            through: {
                table: "playlist_track",
                sourceColumn: "playlist_id",
                targetColumn: "track_id"
            }
        },
    ],
    admin: {
        icon: "Database",
        group: "Reference",
        propertiesOrder: [
            "playlistId",
            "name"
        ]
    }
});

export default playlistCollection;
