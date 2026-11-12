// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import areaCollection from "./area";
import tagCollection from "./tag";

// Introspected as an owned-child: belongs to area (the leading column of a primary key made only of foreign keys) and nothing else references it.

const areaTagCollection = defineCollection({
    name: "Area Tag",
    singularName: "Area Tag",
    slug: "area_tag",
    table: "area_tag",
    properties: {
        area: {
            name: "Area",
            columnName: "area",
            type: "number",
            // Part of composite primary key (area, tag)
            isId: "manual",
            columnType: "integer",
        },
        tag: {
            name: "Tag",
            columnName: "tag",
            type: "number",
            // Part of composite primary key (area, tag)
            isId: "manual",
            columnType: "integer",
        },
        count: {
            name: "Count",
            columnName: "count",
            type: "number",
            columnType: "integer",
            validation: {
                required: true
            },
        },
        lastUpdated: {
            name: "Last Updated",
            columnName: "last_updated",
            type: "date",
            autoValue: "on_create",
            admin: {
                readOnly: true
            },
        },
        areaRelation: {
            name: "AreaRelation",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: area -> area(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => areaCollection,
                localKey: "area",
                onDelete: "no action"
            }
        },
        tagRelation: {
            name: "TagRelation",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: tag -> tag(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => tagCollection,
                localKey: "tag",
                onDelete: "no action"
            }
        },
    },
    admin: {
        icon: "Tag",
        hideFromNavigation: true,
        sort: ["lastUpdated", "desc"],
        propertiesOrder: [
            "area",
            "tag",
            "count",
            "lastUpdated",
            "areaRelation",
            "tagRelation"
        ]
    }
});

export default areaTagCollection;
