// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import areaCollection from "./area";
import editorCollection from "./editor";
import tagCollection from "./tag";

// Introspected as an owned-child: belongs to area (the leading column of a primary key made only of foreign keys) and nothing else references it.

const areaTagRawCollection = defineCollection({
    name: "Area Tag Raw",
    singularName: "Area Tag Raw",
    slug: "area_tag_raw",
    table: "area_tag_raw",
    properties: {
        area: {
            name: "Area",
            columnName: "area",
            type: "number",
            // Part of composite primary key (area, editor, tag)
            isId: "manual",
            columnType: "integer",
        },
        editor: {
            name: "Editor",
            columnName: "editor",
            type: "number",
            // Part of composite primary key (area, editor, tag)
            isId: "manual",
            columnType: "integer",
        },
        tag: {
            name: "Tag",
            columnName: "tag",
            type: "number",
            // Part of composite primary key (area, editor, tag)
            isId: "manual",
            columnType: "integer",
        },
        isUpvote: {
            name: "Is Upvote",
            columnName: "is_upvote",
            type: "boolean",
            defaultValue: true,
            validation: {
                required: true
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
        editorRelation: {
            name: "EditorRelation",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: editor -> editor(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => editorCollection,
                localKey: "editor",
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
        listProperties: [
            "area",
            "editor",
            "tag",
            "isUpvote",
            "areaRelation",
            "editorRelation"
        ],
        propertiesOrder: [
            "area",
            "editor",
            "tag",
            "isUpvote",
            "areaRelation",
            "editorRelation",
            "tagRelation"
        ]
    }
});

export default areaTagRawCollection;
