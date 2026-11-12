// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "k" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "v" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.

const wayTagsCollection = defineCollection({
    name: "Way Tags",
    singularName: "Way Tag",
    slug: "way_tags",
    table: "way_tags",
    properties: {
        wayId: {
            name: "Way Id",
            columnName: "way_id",
            type: "number",
            // Part of composite primary key (way_id, version, k)
            isId: "manual",
            columnType: "bigint",
        },
        k: {
            name: "K",
            columnName: "k",
            type: "string",
            // Part of composite primary key (way_id, version, k)
            isId: "manual",
        },
        version: {
            name: "Version",
            columnName: "version",
            type: "number",
            // Part of composite primary key (way_id, version, k)
            isId: "manual",
            columnType: "bigint",
        },
        v: {
            name: "V",
            columnName: "v",
            type: "string",
            validation: {
                required: true
            },
        },
    },
    admin: {
        icon: "Tag",
        display: { title: "v" },
        propertiesOrder: [
            "wayId",
            "k",
            "version",
            "v"
        ]
    }
});

export default wayTagsCollection;
