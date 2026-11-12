// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import usersCollection from "./users";
import noteCommentsCollection from "./note_comments";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "updated_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "created_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "status" uses the enum type "note_status_enum", and Rebase names a column's enum type <table>_<column>. Rename it before pushing: ALTER TYPE "note_status_enum" RENAME TO "notes_status";
//   - "closed_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "user_ip" is inet, which no property type stores; it is read as text, and a push would plan converting the column to text.

const notesCollection = defineCollection({
    name: "Notes",
    singularName: "Note",
    slug: "notes",
    table: "notes",
    properties: {
        id: {
            name: "Id",
            columnName: "id",
            type: "number",
            isId: "manual",
            columnType: "bigserial",
        },
        status: {
            name: "Status",
            columnName: "status",
            type: "string",
            enum: [{ id: "open", label: "Open" }, { id: "closed", label: "Closed" }, { id: "hidden", label: "Hidden" }],
            validation: {
                required: true
            },
        },
        userIp: {
            name: "User Ip",
            columnName: "user_ip",
            type: "string",
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
            validation: {
                required: true
            },
        },
        closedAt: {
            name: "Closed At",
            columnName: "closed_at",
            type: "date",
        },
        user: {
            name: "User",
            type: "relation",
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
        createdAt: {
            name: "Created At",
            columnName: "created_at",
            type: "date",
            autoValue: "on_create",
            admin: {
                readOnly: true,
                hideFromCollection: true
            },
            validation: {
                required: true
            },
        },
        updatedAt: {
            name: "Updated At",
            columnName: "updated_at",
            type: "date",
            autoValue: "on_update",
            admin: {
                readOnly: true,
                hideFromCollection: true
            },
            validation: {
                required: true
            },
        },
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "note_comments",
            target: (): AnyCollectionConfig => noteCommentsCollection,
            // the note_comments.note_id FK points back here
            foreignKeyOnTarget: "note_id"
        },
        // The many-to-many with users through note_subscriptions is declared on
        // users only: declaring it here too would re-key note_subscriptions
        // from (user_id, note_id) on the next push.
    ],
    admin: {
        icon: "Database",
        display: { title: "description" },
        // A board over "status" fits this table, but a board needs a string column to keep each card's order in. Add one, then declare kanban: { columnProperty: "status" } and orderProperty: "<that property>".,
        listProperties: [
            "id",
            "status",
            "userIp",
            "latitude",
            "longitude",
            "tile"
        ],
        propertiesOrder: [
            "id",
            "status",
            "userIp",
            "latitude",
            "longitude",
            "tile",
            "closedAt",
            "user",
            "description",
            "createdAt",
            "updatedAt"
        ]
    }
});

export default notesCollection;
