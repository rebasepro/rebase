// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import usersCollection from "./users";
import changesetCommentsCollection from "./changeset_comments";
import changesetTagsCollection from "./changeset_tags";
import currentNodesCollection from "./current_nodes";
import currentRelationsCollection from "./current_relations";
import currentWaysCollection from "./current_ways";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "created_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "closed_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).

const changesetsCollection = defineCollection({
    name: "Changesets",
    singularName: "Changeset",
    slug: "changesets",
    table: "changesets",
    properties: {
        id: {
            name: "Id",
            columnName: "id",
            type: "number",
            isId: "manual",
            columnType: "bigserial",
        },
        minLat: {
            name: "Min Lat",
            columnName: "min_lat",
            type: "number",
            columnType: "integer",
        },
        maxLat: {
            name: "Max Lat",
            columnName: "max_lat",
            type: "number",
            columnType: "integer",
        },
        minLon: {
            name: "Min Lon",
            columnName: "min_lon",
            type: "number",
            columnType: "integer",
        },
        maxLon: {
            name: "Max Lon",
            columnName: "max_lon",
            type: "number",
            columnType: "integer",
        },
        numChanges: {
            name: "Num Changes",
            columnName: "num_changes",
            type: "number",
            columnType: "integer",
            defaultValue: 0,
            validation: {
                required: true
            },
        },
        numCreatedNodes: {
            name: "Num Created Nodes",
            columnName: "num_created_nodes",
            type: "number",
            columnType: "integer",
            defaultValue: 0,
            validation: {
                required: true
            },
        },
        numModifiedNodes: {
            name: "Num Modified Nodes",
            columnName: "num_modified_nodes",
            type: "number",
            columnType: "integer",
            defaultValue: 0,
            validation: {
                required: true
            },
        },
        numDeletedNodes: {
            name: "Num Deleted Nodes",
            columnName: "num_deleted_nodes",
            type: "number",
            columnType: "integer",
            defaultValue: 0,
            validation: {
                required: true
            },
        },
        numCreatedWays: {
            name: "Num Created Ways",
            columnName: "num_created_ways",
            type: "number",
            columnType: "integer",
            defaultValue: 0,
            validation: {
                required: true
            },
        },
        numModifiedWays: {
            name: "Num Modified Ways",
            columnName: "num_modified_ways",
            type: "number",
            columnType: "integer",
            defaultValue: 0,
            validation: {
                required: true
            },
        },
        numDeletedWays: {
            name: "Num Deleted Ways",
            columnName: "num_deleted_ways",
            type: "number",
            columnType: "integer",
            defaultValue: 0,
            validation: {
                required: true
            },
        },
        numCreatedRelations: {
            name: "Num Created Relations",
            columnName: "num_created_relations",
            type: "number",
            columnType: "integer",
            defaultValue: 0,
            validation: {
                required: true
            },
        },
        numModifiedRelations: {
            name: "Num Modified Relations",
            columnName: "num_modified_relations",
            type: "number",
            columnType: "integer",
            defaultValue: 0,
            validation: {
                required: true
            },
        },
        numDeletedRelations: {
            name: "Num Deleted Relations",
            columnName: "num_deleted_relations",
            type: "number",
            columnType: "integer",
            defaultValue: 0,
            validation: {
                required: true
            },
        },
        closedAt: {
            name: "Closed At",
            columnName: "closed_at",
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
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "changeset_comments",
            target: (): AnyCollectionConfig => changesetCommentsCollection,
            // the changeset_comments.changeset_id FK points back here
            foreignKeyOnTarget: "changeset_id"
        },
        {
            kind: "hasMany",
            relationName: "changeset_tags",
            target: (): AnyCollectionConfig => changesetTagsCollection,
            // the changeset_tags.changeset_id FK points back here
            foreignKeyOnTarget: "changeset_id"
        },
        {
            kind: "hasMany",
            relationName: "current_nodes",
            target: (): AnyCollectionConfig => currentNodesCollection,
            // the current_nodes.changeset_id FK points back here
            foreignKeyOnTarget: "changeset_id"
        },
        {
            kind: "hasMany",
            relationName: "current_relations",
            target: (): AnyCollectionConfig => currentRelationsCollection,
            // the current_relations.changeset_id FK points back here
            foreignKeyOnTarget: "changeset_id"
        },
        {
            kind: "hasMany",
            relationName: "current_ways",
            target: (): AnyCollectionConfig => currentWaysCollection,
            // the current_ways.changeset_id FK points back here
            foreignKeyOnTarget: "changeset_id"
        },
        {
            kind: "manyToMany",
            relationName: "users",
            target: (): AnyCollectionConfig => usersCollection,
            through: {
                table: "changesets_subscribers",
                sourceColumn: "changeset_id",
                targetColumn: "subscriber_id"
            }
        },
    ],
    admin: {
        icon: "Database",
        listProperties: [
            "id",
            "minLat",
            "maxLat",
            "minLon",
            "maxLon",
            "numChanges"
        ],
        propertiesOrder: [
            "id",
            "minLat",
            "maxLat",
            "minLon",
            "maxLon",
            "numChanges",
            "numCreatedNodes",
            "numModifiedNodes",
            "numDeletedNodes",
            "numCreatedWays",
            "numModifiedWays",
            "numDeletedWays",
            "numCreatedRelations",
            "numModifiedRelations",
            "numDeletedRelations",
            "closedAt",
            "user",
            "createdAt"
        ]
    }
});

export default changesetsCollection;
