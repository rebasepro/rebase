// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import usersCollection from "./users";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "title" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "sent_on" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "body_format" uses the enum type "format_enum", which other columns share; Rebase gives each column its own type (<table>_<column>), so a push would plan "messages_body_format" and a conversion Postgres cannot cast.

const messagesCollection = defineCollection({
    name: "Messages",
    singularName: "Message",
    slug: "messages",
    table: "messages",
    properties: {
        id: {
            name: "Id",
            columnName: "id",
            type: "number",
            isId: "manual",
            columnType: "bigserial",
        },
        title: {
            name: "Title",
            columnName: "title",
            type: "string",
            validation: {
                required: true
            },
        },
        bodyFormat: {
            name: "Body Format",
            columnName: "body_format",
            type: "string",
            enum: [{ id: "html", label: "Html" }, { id: "markdown", label: "Markdown" }, { id: "text", label: "Text" }],
            defaultValue: "markdown",
            validation: {
                required: true
            },
        },
        messageRead: {
            name: "Message Read",
            columnName: "message_read",
            type: "boolean",
            defaultValue: false,
            validation: {
                required: true
            },
        },
        toUserVisible: {
            name: "To User Visible",
            columnName: "to_user_visible",
            type: "boolean",
            defaultValue: true,
            validation: {
                required: true
            },
        },
        fromUserVisible: {
            name: "From User Visible",
            columnName: "from_user_visible",
            type: "boolean",
            defaultValue: true,
            validation: {
                required: true
            },
        },
        muted: {
            name: "Muted",
            columnName: "muted",
            type: "boolean",
            defaultValue: false,
            validation: {
                required: true
            },
        },
        sentOn: {
            name: "Sent On",
            columnName: "sent_on",
            type: "date",
            validation: {
                required: true
            },
        },
        fromUser: {
            name: "FromUser",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: from_user_id -> users(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => usersCollection,
                localKey: "from_user_id",
                onDelete: "no action"
            }
        },
        toUser: {
            name: "ToUser",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: to_user_id -> users(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => usersCollection,
                localKey: "to_user_id",
                onDelete: "no action"
            }
        },
        body: {
            name: "Body",
            columnName: "body",
            type: "string",
            admin: {
                multiline: true,
                markdown: true
            },
            validation: {
                required: true
            },
        },
    },
    admin: {
        icon: "Mail",
        display: { title: "title" },
        // A board over "bodyFormat" fits this table, but a board needs a string column to keep each card's order in. Add one, then declare kanban: { columnProperty: "bodyFormat" } and orderProperty: "<that property>".,
        listProperties: [
            "id",
            "title",
            "bodyFormat",
            "messageRead",
            "toUserVisible",
            "fromUserVisible"
        ],
        propertiesOrder: [
            "id",
            "title",
            "bodyFormat",
            "messageRead",
            "toUserVisible",
            "fromUserVisible",
            "muted",
            "sentOn",
            "fromUser",
            "toUser",
            "body"
        ]
    }
});

export default messagesCollection;
