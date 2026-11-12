// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import areaCollection from "./area";
import artistCreditNameCollection from "./artist_credit_name";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "name" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "sort_name" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "begin_date_year" is smallint, which no `columnType` names; it is declared integer, so a push widens it (every value survives).
//   - "begin_date_month" is smallint, which no `columnType` names; it is declared integer, so a push widens it (every value survives).
//   - "begin_date_day" is smallint, which no `columnType` names; it is declared integer, so a push widens it (every value survives).
//   - "end_date_year" is smallint, which no `columnType` names; it is declared integer, so a push widens it (every value survives).
//   - "end_date_month" is smallint, which no `columnType` names; it is declared integer, so a push widens it (every value survives).
//   - "end_date_day" is smallint, which no `columnType` names; it is declared integer, so a push widens it (every value survives).

const artistCollection = defineCollection({
    name: "Artist",
    singularName: "Artist",
    slug: "artist",
    table: "artist",
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
        sortName: {
            name: "Sort Name",
            columnName: "sort_name",
            type: "string",
            validation: {
                required: true
            },
        },
        type: {
            name: "Type",
            columnName: "type",
            type: "number",
            columnType: "integer",
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
        gender: {
            name: "Gender",
            columnName: "gender",
            type: "number",
            columnType: "integer",
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
        lastUpdated: {
            name: "Last Updated",
            columnName: "last_updated",
            type: "date",
            autoValue: "on_create",
            admin: {
                readOnly: true
            },
        },
        area: {
            name: "Area",
            type: "relation",
            // mapped from foreign key: area -> area(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => areaCollection,
                localKey: "area",
                onDelete: "no action"
            }
        },
        beginArea: {
            name: "BeginArea",
            type: "relation",
            // mapped from foreign key: begin_area -> area(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => areaCollection,
                localKey: "begin_area",
                onDelete: "no action"
            }
        },
        endArea: {
            name: "EndArea",
            type: "relation",
            // mapped from foreign key: end_area -> area(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => areaCollection,
                localKey: "end_area",
                onDelete: "no action"
            }
        },
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "artist_credit_name",
            target: (): AnyCollectionConfig => artistCreditNameCollection,
            // the artist_credit_name.artist FK points back here
            foreignKeyOnTarget: "artist"
        },
    ],
    admin: {
        icon: "Database",
        display: { title: "comment" },
        sort: ["lastUpdated", "desc"],
        listProperties: [
            "id",
            "name",
            "sortName",
            "type",
            "gid",
            "comment"
        ],
        propertiesOrder: [
            "id",
            "name",
            "sortName",
            "type",
            "gid",
            "comment",
            "ended",
            "beginDateYear",
            "beginDateMonth",
            "beginDateDay",
            "endDateYear",
            "endDateMonth",
            "endDateDay",
            "gender",
            "editsPending",
            "lastUpdated",
            "area",
            "beginArea",
            "endArea"
        ]
    }
});

export default artistCollection;
