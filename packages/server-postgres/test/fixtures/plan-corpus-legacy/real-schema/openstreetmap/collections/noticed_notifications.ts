// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "type" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "recipient_type" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "read_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "seen_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "created_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "updated_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).

const noticedNotificationsCollection = defineCollection({
    name: "Noticed Notifications",
    singularName: "Noticed Notification",
    slug: "noticed_notifications",
    table: "noticed_notifications",
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
        recipientType: {
            name: "Recipient Type",
            columnName: "recipient_type",
            type: "string",
            validation: {
                required: true
            },
        },
        eventId: {
            name: "Event Id",
            columnName: "event_id",
            type: "number",
            columnType: "bigint",
            validation: {
                required: true
            },
        },
        recipientId: {
            name: "Recipient Id",
            columnName: "recipient_id",
            type: "number",
            columnType: "bigint",
            validation: {
                required: true
            },
        },
        readAt: {
            name: "Read At",
            columnName: "read_at",
            type: "date",
        },
        seenAt: {
            name: "Seen At",
            columnName: "seen_at",
            type: "date",
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
        icon: "Mail",
        display: { title: "recipientType" },
        listProperties: [
            "id",
            "type",
            "recipientType",
            "eventId",
            "recipientId",
            "readAt"
        ],
        propertiesOrder: [
            "id",
            "type",
            "recipientType",
            "eventId",
            "recipientId",
            "readAt",
            "seenAt",
            "createdAt",
            "updatedAt"
        ]
    }
});

export default noticedNotificationsCollection;
