// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import trackCollection from "./track";

// Introspected as a lookup: a 5-row code list: referenced by 1 table(s), references none, 3 or fewer simple columns.

const mediaTypeCollection = defineCollection({
    name: "Media Type",
    singularName: "Media Type",
    slug: "media_type",
    table: "media_type",
    properties: {
        mediaTypeId: {
            name: "Media Type Id",
            columnName: "media_type_id",
            type: "number",
            isId: "manual",
            columnType: "integer",
        },
        name: {
            name: "Name",
            columnName: "name",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 120
            },
        },
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "track",
            target: (): AnyCollectionConfig => trackCollection,
            // the track.media_type_id FK points back here
            foreignKeyOnTarget: "media_type_id"
        },
    ],
    admin: {
        icon: "Image",
        group: "Reference",
        propertiesOrder: [
            "mediaTypeId",
            "name"
        ]
    }
});

export default mediaTypeCollection;
