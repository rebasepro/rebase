// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import currentNodesCollection from "./current_nodes";

// Introspected as an owned-child: belongs to current_nodes (its only foreign key inside the primary key) and nothing else references it.

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "k" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "v" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.

const currentNodeTagsCollection = defineCollection({
    name: "Current Node Tags",
    singularName: "Current Node Tag",
    slug: "current_node_tags",
    table: "current_node_tags",
    properties: {
        nodeId: {
            name: "Node Id",
            columnName: "node_id",
            type: "number",
            // Part of composite primary key (node_id, k)
            isId: "manual",
            columnType: "bigint",
        },
        k: {
            name: "K",
            columnName: "k",
            type: "string",
            // Part of composite primary key (node_id, k)
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
        node: {
            name: "Node",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: node_id -> current_nodes(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => currentNodesCollection,
                localKey: "node_id",
                onDelete: "no action"
            }
        },
    },
    admin: {
        icon: "Tag",
        hideFromNavigation: true,
        display: { title: "v" },
        propertiesOrder: [
            "nodeId",
            "k",
            "v",
            "node"
        ]
    }
});

export default currentNodeTagsCollection;
