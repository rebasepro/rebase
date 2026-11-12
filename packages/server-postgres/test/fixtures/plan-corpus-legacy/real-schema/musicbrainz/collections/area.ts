// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import areaTypeCollection from "./area_type";
import areaTagCollection from "./area_tag";
import areaTagRawCollection from "./area_tag_raw";
import artistCollection from "./artist";
import editorCollection from "./editor";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "name" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "begin_date_year" is smallint, which no `columnType` names; it is declared integer, so a push widens it (every value survives).
//   - "begin_date_month" is smallint, which no `columnType` names; it is declared integer, so a push widens it (every value survives).
//   - "begin_date_day" is smallint, which no `columnType` names; it is declared integer, so a push widens it (every value survives).
//   - "end_date_year" is smallint, which no `columnType` names; it is declared integer, so a push widens it (every value survives).
//   - "end_date_month" is smallint, which no `columnType` names; it is declared integer, so a push widens it (every value survives).
//   - "end_date_day" is smallint, which no `columnType` names; it is declared integer, so a push widens it (every value survives).

const areaCollection = defineCollection({
    name: "Area",
    singularName: "Area",
    slug: "area",
    table: "area",
    properties: {
        id: {
            name: "Id",
            columnName: "id",
            type: "number",
            isId: "manual",
            columnType: "serial",
        },
        name: {
            name: "Name",
            columnName: "name",
            type: "string",
            validation: {
                required: true
            },
        },
        type: {
            name: "Type",
            type: "relation",
            // mapped from foreign key: type -> area_type(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => areaTypeCollection,
                localKey: "type",
                onDelete: "no action"
            }
        },
        gid: {
            name: "Gid",
            columnName: "gid",
            type: "string",
            columnType: "uuid",
            validation: {
                required: true
            },
        },
        comment: {
            name: "Comment",
            columnName: "comment",
            type: "string",
            columnType: "varchar",
            defaultValue: "",
            validation: {
                required: true,
                max: 255
            },
        },
        ended: {
            name: "Ended",
            columnName: "ended",
            type: "boolean",
            defaultValue: false,
            validation: {
                required: true
            },
        },
        editsPending: {
            name: "Edits Pending",
            columnName: "edits_pending",
            type: "number",
            columnType: "integer",
            defaultValue: 0,
            validation: {
                required: true,
                min: 0
            },
        },
        beginDateYear: {
            name: "Begin Date Year",
            columnName: "begin_date_year",
            type: "number",
            columnType: "integer",
        },
        beginDateMonth: {
            name: "Begin Date Month",
            columnName: "begin_date_month",
            type: "number",
            columnType: "integer",
        },
        beginDateDay: {
            name: "Begin Date Day",
            columnName: "begin_date_day",
            type: "number",
            columnType: "integer",
        },
        endDateYear: {
            name: "End Date Year",
            columnName: "end_date_year",
            type: "number",
            columnType: "integer",
        },
        endDateMonth: {
            name: "End Date Month",
            columnName: "end_date_month",
            type: "number",
            columnType: "integer",
        },
        endDateDay: {
            name: "End Date Day",
            columnName: "end_date_day",
            type: "number",
            columnType: "integer",
        },
        lastUpdated: {
            name: "Last Updated",
            columnName: "last_updated",
            type: "date",
            autoValue: "on_create",
            admin: {
                readOnly: true
            },
        },
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "area_tag",
            target: (): AnyCollectionConfig => areaTagCollection,
            // the area_tag.area FK points back here
            foreignKeyOnTarget: "area"
        },
        {
            kind: "hasMany",
            relationName: "area_tag_raw",
            target: (): AnyCollectionConfig => areaTagRawCollection,
            // the area_tag_raw.area FK points back here
            foreignKeyOnTarget: "area"
        },
        {
            kind: "hasMany",
            relationName: "artist",
            target: (): AnyCollectionConfig => artistCollection,
            // the artist.area FK points back here
            foreignKeyOnTarget: "area"
        },
        {
            kind: "hasMany",
            relationName: "artist_by_begin_area",
            target: (): AnyCollectionConfig => artistCollection,
            // the artist.begin_area FK points back here
            foreignKeyOnTarget: "begin_area"
        },
        {
            kind: "hasMany",
            relationName: "artist_by_end_area",
            target: (): AnyCollectionConfig => artistCollection,
            // the artist.end_area FK points back here
            foreignKeyOnTarget: "end_area"
        },
        {
            kind: "hasMany",
            relationName: "editor",
            target: (): AnyCollectionConfig => editorCollection,
            // the editor.area FK points back here
            foreignKeyOnTarget: "area"
        },
    ],
    admin: {
        icon: "Database",
        display: { title: "comment" },
        sort: ["lastUpdated", "desc"],
        listProperties: [
            "id",
            "name",
            "type",
            "gid",
            "comment",
            "ended"
        ],
        propertiesOrder: [
            "id",
            "name",
            "type",
            "gid",
            "comment",
            "ended",
            "editsPending",
            "beginDateYear",
            "beginDateMonth",
            "beginDateDay",
            "endDateYear",
            "endDateMonth",
            "endDateDay",
            "lastUpdated"
        ]
    }
});

export default areaCollection;
