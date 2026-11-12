// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import changesetsCollection from "./changesets";
import currentRelationMembersCollection from "./current_relation_members";
import currentRelationTagsCollection from "./current_relation_tags";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "timestamp" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).

const currentRelationsCollection = defineCollection({
    name: "Current Relations",
    singularName: "Current Relation",
    slug: "current_relations",
    table: "current_relations",
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
            relationName: "current_relation_members",
            target: (): AnyCollectionConfig => currentRelationMembersCollection,
            // the current_relation_members.relation_id FK points back here
            foreignKeyOnTarget: "relation_id"
        },
        {
            kind: "hasMany",
            relationName: "current_relation_tags",
            target: (): AnyCollectionConfig => currentRelationTagsCollection,
            // the current_relation_tags.relation_id FK points back here
            foreignKeyOnTarget: "relation_id"
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

export default currentRelationsCollection;
