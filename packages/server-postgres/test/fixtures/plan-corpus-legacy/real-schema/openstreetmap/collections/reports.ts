// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import issuesCollection from "./issues";
import usersCollection from "./users";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "category" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "created_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "updated_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).

const reportsCollection = defineCollection({
    name: "Reports",
    singularName: "Report",
    slug: "reports",
    table: "reports",
    properties: {
        id: {
            name: "Id",
            columnName: "id",
            type: "number",
            isId: "manual",
            columnType: "serial",
        },
        category: {
            name: "Category",
            columnName: "category",
            type: "string",
            validation: {
                required: true
            },
        },
        issue: {
            name: "Issue",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: issue_id -> issues(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => issuesCollection,
                localKey: "issue_id",
                onDelete: "no action"
            }
        },
        user: {
            name: "User",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: user_id -> users(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => usersCollection,
                localKey: "user_id",
                onDelete: "no action"
            }
        },
        details: {
            name: "Details",
            columnName: "details",
            type: "string",
            admin: {
                multiline: true
            },
            validation: {
                required: true
            },
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
        display: { title: "details" },
        propertiesOrder: [
            "id",
            "category",
            "issue",
            "user",
            "details",
            "createdAt",
            "updatedAt"
        ]
    }
});

export default reportsCollection;
