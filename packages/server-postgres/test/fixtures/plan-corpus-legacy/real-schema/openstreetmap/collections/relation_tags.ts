// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "k" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "v" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.

const relationTagsCollection = defineCollection({
    name: "Relation Tags",
    singularName: "Relation Tag",
    slug: "relation_tags",
    table: "relation_tags",
    properties: {
        relationId: {
            name: "Relation Id",
            columnName: "relation_id",
            type: "number",
            // Part of composite primary key (relation_id, version, k)
            isId: "manual",
            columnType: "bigint",
        },
        k: {
            name: "K",
            columnName: "k",
            type: "string",
            // Part of composite primary key (relation_id, version, k)
            isId: "sql`''::character varying`",
        },
        version: {
            name: "Version",
            columnName: "version",
            type: "number",
            // Part of composite primary key (relation_id, version, k)
            isId: "manual",
            columnType: "bigint",
        },
        v: {
            name: "V",
            columnName: "v",
            type: "string",
            defaultValue: "",
            validation: {
                required: true
            },
        },
    },
    admin: {
        icon: "Tag",
        display: { title: "v" },
        propertiesOrder: [
            "relationId",
            "k",
            "version",
            "v"
        ]
    }
});

export default relationTagsCollection;
