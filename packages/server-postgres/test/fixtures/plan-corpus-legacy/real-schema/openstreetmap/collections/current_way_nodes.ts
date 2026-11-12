// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import currentWaysCollection from "./current_ways";
import currentNodesCollection from "./current_nodes";

// Introspected as an owned-child: belongs to current_ways (its only foreign key inside the primary key) and nothing else references it.

const currentWayNodesCollection = defineCollection({
    name: "Current Way Nodes",
    singularName: "Current Way Node",
    slug: "current_way_nodes",
    table: "current_way_nodes",
    properties: {
        wayId: {
            name: "Way Id",
            columnName: "way_id",
            type: "number",
            // Part of composite primary key (way_id, sequence_id)
            isId: "manual",
            columnType: "bigint",
        },
        sequenceId: {
            name: "Sequence Id",
            columnName: "sequence_id",
            type: "number",
            // Part of composite primary key (way_id, sequence_id)
            isId: "manual",
            columnType: "bigint",
        },
        way: {
            name: "Way",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: way_id -> current_ways(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => currentWaysCollection,
                localKey: "way_id",
                onDelete: "no action"
            }
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
        icon: "Database",
        hideFromNavigation: true,
        propertiesOrder: [
            "wayId",
            "sequenceId",
            "way",
            "node"
        ]
    }
});

export default currentWayNodesCollection;
