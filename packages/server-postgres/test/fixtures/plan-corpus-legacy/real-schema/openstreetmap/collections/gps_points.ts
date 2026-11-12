// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import gpxFilesCollection from "./gpx_files";

// Introspected as an owned-child: belongs to gpx_files (its only NOT NULL foreign key) and nothing else references it.

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "timestamp" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).

const gpsPointsCollection = defineCollection({
    name: "Gps Points",
    singularName: "Gps Point",
    slug: "gps_points",
    table: "gps_points",
    properties: {
        altitude: {
            name: "Altitude",
            columnName: "altitude",
            type: "number",
            columnType: "double precision",
        },
        trackid: {
            name: "Trackid",
            columnName: "trackid",
            type: "number",
            columnType: "integer",
            validation: {
                required: true
            },
        },
        latitude: {
            name: "Latitude",
            columnName: "latitude",
            type: "number",
            columnType: "integer",
            validation: {
                required: true
            },
        },
        longitude: {
            name: "Longitude",
            columnName: "longitude",
            type: "number",
            columnType: "integer",
            validation: {
                required: true
            },
        },
        tile: {
            name: "Tile",
            columnName: "tile",
            type: "number",
            columnType: "bigint",
        },
        timestamp: {
            name: "Timestamp",
            columnName: "timestamp",
            type: "date",
        },
        gpx: {
            name: "Gpx",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: gpx_id -> gpx_files(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => gpxFilesCollection,
                localKey: "gpx_id",
                onDelete: "no action"
            }
        },
    },
    admin: {
        icon: "Database",
        hideFromNavigation: true,
        listProperties: [
            "altitude",
            "trackid",
            "latitude",
            "longitude",
            "tile",
            "timestamp"
        ],
        propertiesOrder: [
            "altitude",
            "trackid",
            "latitude",
            "longitude",
            "tile",
            "timestamp",
            "gpx"
        ]
    }
});

export default gpsPointsCollection;
