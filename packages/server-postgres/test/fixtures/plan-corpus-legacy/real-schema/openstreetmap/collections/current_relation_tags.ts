// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import currentRelationsCollection from "./current_relations";

// Introspected as an owned-child: belongs to current_relations (its only foreign key inside the primary key) and nothing else references it.

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "k" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "v" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.

const currentRelationTagsCollection = defineCollection({
    name: "Current Relation Tags",
    singularName: "Current Relation Tag",
    slug: "current_relation_tags",
    table: "current_relation_tags",
    properties: {
        relationId: {
            name: "Relation Id",
            columnName: "relation_id",
            type: "number",
            // Part of composite primary key (relation_id, k)
            isId: "manual",
            columnType: "bigint",
        },
        k: {
            name: "K",
            columnName: "k",
            type: "string",
            // Part of composite primary key (relation_id, k)
            isId: "sql`''::character varying`",
        },
        v: {
            name: "V",
            columnName: "v",
            type: "string",
            defaultValue: "",
            validation: {
                required: true
            },
        },
        relation: {
            name: "Relation",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: relation_id -> current_relations(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => currentRelationsCollection,
                localKey: "relation_id",
                onDelete: "no action"
            }
        },
    },
    admin: {
        icon: "Tag",
        hideFromNavigation: true,
        display: { title: "v" },
        propertiesOrder: [
            "relationId",
            "k",
            "v",
            "relation"
        ]
    }
});

export default currentRelationTagsCollection;
