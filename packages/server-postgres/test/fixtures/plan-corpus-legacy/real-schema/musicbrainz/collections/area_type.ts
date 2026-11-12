// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import areaCollection from "./area";

const areaTypeCollection = defineCollection({
    name: "Area Type",
    singularName: "Area Type",
    slug: "area_type",
    table: "area_type",
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
            columnType: "varchar",
            validation: {
                required: true,
                max: 255
            },
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
        childOrder: {
            name: "Child Order",
            columnName: "child_order",
            type: "number",
            columnType: "integer",
            defaultValue: 0,
            validation: {
                required: true
            },
        },
        parent: {
            name: "Parent",
            type: "relation",
            // mapped from foreign key: parent -> area_type(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => areaTypeCollection,
                localKey: "parent",
                onDelete: "no action"
            }
        },
        description: {
            name: "Description",
            columnName: "description",
            type: "string",
            admin: {
                multiline: true
            },
        },
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "area",
            target: (): AnyCollectionConfig => areaCollection,
            // the area.type FK points back here
            foreignKeyOnTarget: "type"
        },
        {
            kind: "hasMany",
            relationName: "area_type",
            target: (): AnyCollectionConfig => areaTypeCollection,
            // the area_type.parent FK points back here
            foreignKeyOnTarget: "parent"
        },
    ],
    admin: {
        icon: "Database",
        display: { title: "name" },
        propertiesOrder: [
            "id",
            "name",
            "gid",
            "childOrder",
            "parent",
            "description"
        ]
    }
});

export default areaTypeCollection;
