// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import areaTagCollection from "./area_tag";
import areaTagRawCollection from "./area_tag_raw";

const tagCollection = defineCollection({
    name: "Tag",
    singularName: "Tag",
    slug: "tag",
    table: "tag",
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
        refCount: {
            name: "Ref Count",
            columnName: "ref_count",
            type: "number",
            columnType: "integer",
            defaultValue: 0,
            validation: {
                required: true
            },
        },
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "area_tag",
            target: (): AnyCollectionConfig => areaTagCollection,
            // the area_tag.tag FK points back here
            foreignKeyOnTarget: "tag"
        },
        {
            kind: "hasMany",
            relationName: "area_tag_raw",
            target: (): AnyCollectionConfig => areaTagRawCollection,
            // the area_tag_raw.tag FK points back here
            foreignKeyOnTarget: "tag"
        },
    ],
    admin: {
        icon: "Tag",
        display: { title: "name" },
        propertiesOrder: [
            "id",
            "name",
            "refCount"
        ]
    }
});

export default tagCollection;
