// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import constraintShapesCollection from "./constraint_shapes";

// Introspected as an owned-child: belongs to constraint_shapes (its only ON DELETE CASCADE foreign key) and nothing else references it.

const constraintShapesChildCollection = defineCollection({
    name: "Constraint Shapes Child",
    singularName: "Constraint Shapes Child",
    slug: "constraint_shapes_child",
    table: "constraint_shapes_child",
    properties: {
        id: {
            name: "Id",
            columnName: "id",
            type: "number",
            isId: "manual",
            columnType: "integer",
        },
        parent: {
            name: "Parent",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: parent_id -> constraint_shapes(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => constraintShapesCollection,
                localKey: "parent_id",
                onDelete: "cascade"
            }
        },
        note: {
            name: "Note",
            columnName: "note",
            type: "string",
            admin: {
                multiline: true
            },
        },
    },
    admin: {
        icon: "Database",
        hideFromNavigation: true,
        propertiesOrder: [
            "id",
            "parent",
            "note"
        ]
    }
});

export default constraintShapesChildCollection;
