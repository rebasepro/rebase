// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "type" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "record_type" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "created_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "updated_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).

const noticedEventsCollection = defineCollection({
    name: "Noticed Events",
    singularName: "Noticed Event",
    slug: "noticed_events",
    table: "noticed_events",
    properties: {
        id: {
            name: "Id",
            columnName: "id",
            type: "number",
            isId: "manual",
            columnType: "bigserial",
        },
        type: {
            name: "Type",
            columnName: "type",
            type: "string",
        },
        recordType: {
            name: "Record Type",
            columnName: "record_type",
            type: "string",
        },
        recordId: {
            name: "Record Id",
            columnName: "record_id",
            type: "number",
            columnType: "bigint",
        },
        notificationsCount: {
            name: "Notifications Count",
            columnName: "notifications_count",
            type: "number",
            columnType: "integer",
        },
        params: {
            name: "Params",
            columnName: "params",
            type: "map",
            keyValue: true,
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
        icon: "Activity",
        propertiesOrder: [
            "id",
            "type",
            "recordType",
            "recordId",
            "notificationsCount",
            "params",
            "createdAt",
            "updatedAt"
        ]
    }
});

export default noticedEventsCollection;
