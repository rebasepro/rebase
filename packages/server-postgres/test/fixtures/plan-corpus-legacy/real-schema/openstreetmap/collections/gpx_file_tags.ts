// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import gpxFilesCollection from "./gpx_files";

// Introspected as an owned-child: belongs to gpx_files (its only NOT NULL foreign key) and nothing else references it.

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "tag" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.

const gpxFileTagsCollection = defineCollection({
    name: "Gpx File Tags",
    singularName: "Gpx File Tag",
    slug: "gpx_file_tags",
    table: "gpx_file_tags",
    properties: {
        id: {
            name: "Id",
            columnName: "id",
            type: "number",
            isId: "manual",
            columnType: "bigserial",
        },
        tag: {
            name: "Tag",
            columnName: "tag",
            type: "string",
            validation: {
                required: true
            },
        },
        gpx: {
            name: "Gpx",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: gpx_id -> gpx_files(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => gpxFilesCollection,
                localKey: "gpx_id",
                onDelete: "no action"
            }
        },
    },
    admin: {
        icon: "Tag",
        hideFromNavigation: true,
        display: { title: "tag" },
        propertiesOrder: [
            "id",
            "tag",
            "gpx"
        ]
    }
});

export default gpxFileTagsCollection;
