// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import albumCollection from "./album";
import genreCollection from "./genre";
import mediaTypeCollection from "./media_type";
import invoiceLineCollection from "./invoice_line";
import playlistCollection from "./playlist";

const trackCollection = defineCollection({
    name: "Track",
    singularName: "Track",
    slug: "track",
    table: "track",
    properties: {
        trackId: {
            name: "Track Id",
            columnName: "track_id",
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
                required: true,
                max: 200
            },
        },
        composer: {
            name: "Composer",
            columnName: "composer",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 220
            },
        },
        milliseconds: {
            name: "Milliseconds",
            columnName: "milliseconds",
            type: "number",
            columnType: "integer",
            validation: {
                required: true
            },
        },
        bytes: {
            name: "Bytes",
            columnName: "bytes",
            type: "number",
            columnType: "integer",
        },
        unitPrice: {
            name: "Unit Price",
            columnName: "unit_price",
            type: "number",
            precision: 10,
            scale: 2,
            validation: {
                required: true
            },
        },
        album: {
            name: "Album",
            type: "relation",
            // mapped from foreign key: album_id -> album(album_id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => albumCollection,
                localKey: "album_id",
                onDelete: "no action"
            }
        },
        genre: {
            name: "Genre",
            type: "relation",
            // mapped from foreign key: genre_id -> genre(genre_id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => genreCollection,
                localKey: "genre_id",
                onDelete: "no action"
            }
        },
        mediaType: {
            name: "MediaType",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: media_type_id -> media_type(media_type_id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => mediaTypeCollection,
                localKey: "media_type_id",
                onDelete: "no action"
            }
        },
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "invoice_line",
            target: (): AnyCollectionConfig => invoiceLineCollection,
            // the invoice_line.track_id FK points back here
            foreignKeyOnTarget: "track_id"
        },
        {
            kind: "manyToMany",
            relationName: "playlist",
            target: (): AnyCollectionConfig => playlistCollection,
            through: {
                table: "playlist_track",
                sourceColumn: "track_id",
                targetColumn: "playlist_id"
            }
        },
    ],
    admin: {
        icon: "Database",
        display: { title: "name" },
        listProperties: [
            "trackId",
            "name",
            "composer",
            "milliseconds",
            "bytes",
            "unitPrice"
        ],
        propertiesOrder: [
            "trackId",
            "name",
            "composer",
            "milliseconds",
            "bytes",
            "unitPrice",
            "album",
            "genre",
            "mediaType"
        ]
    }
});

export default trackCollection;
