// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "run_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "locked_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "failed_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "locked_by" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "queue" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "created_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "updated_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).

const delayedJobsCollection = defineCollection({
    name: "Delayed Jobs",
    singularName: "Delayed Job",
    slug: "delayed_jobs",
    table: "delayed_jobs",
    properties: {
        id: {
            name: "Id",
            columnName: "id",
            type: "number",
            isId: "manual",
            columnType: "bigserial",
        },
        priority: {
            name: "Priority",
            columnName: "priority",
            type: "number",
            columnType: "integer",
            defaultValue: 0,
            validation: {
                required: true
            },
        },
        lockedBy: {
            name: "Locked By",
            columnName: "locked_by",
            type: "string",
        },
        queue: {
            name: "Queue",
            columnName: "queue",
            type: "string",
        },
        attempts: {
            name: "Attempts",
            columnName: "attempts",
            type: "number",
            columnType: "integer",
            defaultValue: 0,
            validation: {
                required: true
            },
        },
        runAt: {
            name: "Run At",
            columnName: "run_at",
            type: "date",
        },
        lockedAt: {
            name: "Locked At",
            columnName: "locked_at",
            type: "date",
        },
        failedAt: {
            name: "Failed At",
            columnName: "failed_at",
            type: "date",
        },
        handler: {
            name: "Handler",
            columnName: "handler",
            type: "string",
            admin: {
                multiline: true
            },
            validation: {
                required: true
            },
        },
        lastError: {
            name: "Last Error",
            columnName: "last_error",
            type: "string",
            admin: {
                multiline: true
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
        },
    },
    admin: {
        icon: "Database",
        display: { title: "handler" },
        listProperties: [
            "id",
            "priority",
            "lockedBy",
            "queue",
            "attempts",
            "runAt"
        ],
        propertiesOrder: [
            "id",
            "priority",
            "lockedBy",
            "queue",
            "attempts",
            "runAt",
            "lockedAt",
            "failedAt",
            "handler",
            "lastError",
            "createdAt",
            "updatedAt"
        ]
    }
});

export default delayedJobsCollection;
