// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import changesetsCollection from "./changesets";
import currentNodeTagsCollection from "./current_node_tags";
import currentWayNodesCollection from "./current_way_nodes";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "timestamp" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).

const currentNodesCollection = defineCollection({
    name: "Current Nodes",
    singularName: "Current Node",
    slug: "current_nodes",
    table: "current_nodes",
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
            relationName: "current_node_tags",
            target: (): AnyCollectionConfig => currentNodeTagsCollection,
            // the current_node_tags.node_id FK points back here
            foreignKeyOnTarget: "node_id"
        },
        {
            kind: "hasMany",
            relationName: "current_way_nodes",
            target: (): AnyCollectionConfig => currentWayNodesCollection,
            // the current_way_nodes.node_id FK points back here
            foreignKeyOnTarget: "node_id"
        },
    ],
    admin: {
        icon: "Database",
        listProperties: [
            "id",
            "visible",
            "latitude",
            "longitude",
            "tile",
            "version"
        ],
        propertiesOrder: [
            "id",
            "visible",
            "latitude",
            "longitude",
            "tile",
            "version",
            "timestamp",
            "changeset"
        ]
    }
});

export default currentNodesCollection;
