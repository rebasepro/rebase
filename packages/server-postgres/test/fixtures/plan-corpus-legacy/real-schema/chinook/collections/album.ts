// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import artistCollection from "./artist";
import trackCollection from "./track";

const albumCollection = defineCollection({
    name: "Album",
    singularName: "Album",
    slug: "album",
    table: "album",
    properties: {
        albumId: {
            name: "Album Id",
            columnName: "album_id",
            type: "number",
            isId: "manual",
            columnType: "integer",
        },
        title: {
            name: "Title",
            columnName: "title",
            type: "string",
            columnType: "varchar",
            validation: {
                required: true,
                max: 160
            },
        },
        artist: {
            name: "Artist",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: artist_id -> artist(artist_id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => artistCollection,
                localKey: "artist_id",
                onDelete: "no action"
            }
        },
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "track",
            target: (): AnyCollectionConfig => trackCollection,
            // the track.album_id FK points back here
            foreignKeyOnTarget: "album_id"
        },
    ],
    admin: {
        icon: "Database",
        display: { title: "title" },
        propertiesOrder: [
            "albumId",
            "title",
            "artist"
        ]
    }
});

export default albumCollection;
