// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import usersCollection from "./users";
import gpsPointsCollection from "./gps_points";
import gpxFileTagsCollection from "./gpx_file_tags";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "name" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "timestamp" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "description" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "visibility" uses the enum type "gpx_visibility_enum", and Rebase names a column's enum type <table>_<column>. Rename it before pushing: ALTER TYPE "gpx_visibility_enum" RENAME TO "gpx_files_visibility";

const gpxFilesCollection = defineCollection({
    name: "Gpx Files",
    singularName: "Gpx File",
    slug: "gpx_files",
    table: "gpx_files",
    properties: {
        id: {
            name: "Id",
            columnName: "id",
            type: "number",
            isId: "manual",
            columnType: "bigserial",
        },
        name: {
            name: "Name",
            columnName: "name",
            type: "string",
            defaultValue: "",
            validation: {
                required: true
            },
        },
        visibility: {
            name: "Visibility",
            columnName: "visibility",
            type: "string",
            enum: [{ id: "private", label: "Private" }, { id: "public", label: "Public" }, { id: "trackable", label: "Trackable" }, { id: "identifiable", label: "Identifiable" }],
            defaultValue: "public",
            validation: {
                required: true
            },
        },
        visible: {
            name: "Visible",
            columnName: "visible",
            type: "boolean",
            defaultValue: true,
            validation: {
                required: true
            },
        },
        inserted: {
            name: "Inserted",
            columnName: "inserted",
            type: "boolean",
            validation: {
                required: true
            },
        },
        size: {
            name: "Size",
            columnName: "size",
            type: "number",
            columnType: "bigint",
        },
        latitude: {
            name: "Latitude",
            columnName: "latitude",
            type: "number",
            columnType: "double precision",
        },
        longitude: {
            name: "Longitude",
            columnName: "longitude",
            type: "number",
            columnType: "double precision",
        },
        timestamp: {
            name: "Timestamp",
            columnName: "timestamp",
            type: "date",
            validation: {
                required: true
            },
        },
        user: {
            name: "User",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: user_id -> users(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => usersCollection,
                localKey: "user_id",
                onDelete: "no action"
            }
        },
        description: {
            name: "Description",
            columnName: "description",
            type: "string",
            admin: {
                multiline: true
            },
            defaultValue: "",
            validation: {
                required: true
            },
        },
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "gps_points",
            target: (): AnyCollectionConfig => gpsPointsCollection,
            // the gps_points.gpx_id FK points back here
            foreignKeyOnTarget: "gpx_id"
        },
        {
            kind: "hasMany",
            relationName: "gpx_file_tags",
            target: (): AnyCollectionConfig => gpxFileTagsCollection,
            // the gpx_file_tags.gpx_id FK points back here
            foreignKeyOnTarget: "gpx_id"
        },
    ],
    admin: {
        icon: "Database",
        display: { title: "name" },
        // A board over "visibility" fits this table, but a board needs a string column to keep each card's order in. Add one, then declare kanban: { columnProperty: "visibility" } and orderProperty: "<that property>".,
        listProperties: [
            "id",
            "name",
            "visibility",
            "visible",
            "inserted",
            "size"
        ],
        propertiesOrder: [
            "id",
            "name",
            "visibility",
            "visible",
            "inserted",
            "size",
            "latitude",
            "longitude",
            "timestamp",
            "user",
            "description"
        ]
    }
});

export default gpxFilesCollection;
