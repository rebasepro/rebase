// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "key" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "value" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "created_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "updated_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).

const arInternalMetadataCollection = defineCollection({
    name: "Ar Internal Metadata",
    singularName: "Ar Internal Metadata",
    slug: "ar_internal_metadata",
    table: "ar_internal_metadata",
    properties: {
        key: {
            name: "Key",
            columnName: "key",
            type: "string",
            isId: "manual",
        },
        value: {
            name: "Value",
            columnName: "value",
            type: "string",
        },
        createdAt: {
            name: "Created At",
            columnName: "created_at",
            type: "date",
            autoValue: "on_create",
            admin: {
                readOnly: true,
                hideFromCollection: true
            },
            validation: {
                required: true
            },
        },
        updatedAt: {
            name: "Updated At",
            columnName: "updated_at",
            type: "date",
            autoValue: "on_update",
            admin: {
                readOnly: true,
                hideFromCollection: true
            },
            validation: {
                required: true
            },
        },
    },
    admin: {
        icon: "Database",
        propertiesOrder: [
            "key",
            "value",
            "createdAt",
            "updatedAt"
        ]
    }
});

export default arInternalMetadataCollection;
