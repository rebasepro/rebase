// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import changesetsCollection from "./changesets";
import currentWayNodesCollection from "./current_way_nodes";
import currentWayTagsCollection from "./current_way_tags";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "timestamp" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).

const currentWaysCollection = defineCollection({
    name: "Current Ways",
    singularName: "Current Way",
    slug: "current_ways",
    table: "current_ways",
    properties: {
        id: {
            name: "Id",
            columnName: "id",
            type: "number",
            isId: "manual",
            columnType: "bigserial",
        },
        visible: {
            name: "Visible",
            columnName: "visible",
            type: "boolean",
            validation: {
                required: true
            },
        },
        version: {
            name: "Version",
            columnName: "version",
            type: "number",
            columnType: "bigint",
            validation: {
                required: true
            },
        },
        timestamp: {
            name: "Timestamp",
            columnName: "timestamp",
            type: "date",
            validation: {
                required: true
            },
        },
        changeset: {
            name: "Changeset",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: changeset_id -> changesets(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => changesetsCollection,
                localKey: "changeset_id",
                onDelete: "no action"
            }
        },
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "current_way_nodes",
            target: (): AnyCollectionConfig => currentWayNodesCollection,
            // the current_way_nodes.way_id FK points back here
            foreignKeyOnTarget: "way_id"
        },
        {
            kind: "hasMany",
            relationName: "current_way_tags",
            target: (): AnyCollectionConfig => currentWayTagsCollection,
            // the current_way_tags.way_id FK points back here
            foreignKeyOnTarget: "way_id"
        },
    ],
    admin: {
        icon: "Database",
        propertiesOrder: [
            "id",
            "visible",
            "version",
            "timestamp",
            "changeset"
        ]
    }
});

export default currentWaysCollection;
