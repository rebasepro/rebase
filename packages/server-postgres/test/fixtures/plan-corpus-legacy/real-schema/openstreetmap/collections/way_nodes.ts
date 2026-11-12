// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";

const wayNodesCollection = defineCollection({
    name: "Way Nodes",
    singularName: "Way Node",
    slug: "way_nodes",
    table: "way_nodes",
    properties: {
        wayId: {
            name: "Way Id",
            columnName: "way_id",
            type: "number",
            // Part of composite primary key (way_id, version, sequence_id)
            isId: "manual",
            columnType: "bigint",
        },
        version: {
            name: "Version",
            columnName: "version",
            type: "number",
            // Part of composite primary key (way_id, version, sequence_id)
            isId: "manual",
            columnType: "bigint",
        },
        sequenceId: {
            name: "Sequence Id",
            columnName: "sequence_id",
            type: "number",
            // Part of composite primary key (way_id, version, sequence_id)
            isId: "manual",
            columnType: "bigint",
        },
        nodeId: {
            name: "Node Id",
            columnName: "node_id",
            type: "number",
            columnType: "bigint",
            validation: {
                required: true
            },
        },
    },
    admin: {
        icon: "Database",
        propertiesOrder: [
            "wayId",
            "version",
            "sequenceId",
            "nodeId"
        ]
    }
});

export default wayNodesCollection;
