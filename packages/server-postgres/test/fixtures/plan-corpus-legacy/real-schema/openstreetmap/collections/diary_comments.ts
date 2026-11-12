// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import diaryEntriesCollection from "./diary_entries";
import usersCollection from "./users";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "created_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "updated_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "body_format" uses the enum type "format_enum", which other columns share; Rebase gives each column its own type (<table>_<column>), so a push would plan "diary_comments_body_format" and a conversion Postgres cannot cast.

const diaryCommentsCollection = defineCollection({
    name: "Diary Comments",
    singularName: "Diary Comment",
    slug: "diary_comments",
    table: "diary_comments",
    properties: {
        id: {
            name: "Id",
            columnName: "id",
            type: "number",
            isId: "manual",
            columnType: "bigserial",
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
        visible: {
            name: "Visible",
            columnName: "visible",
            type: "boolean",
            defaultValue: true,
            validation: {
                required: true
            },
        },
        diaryEntry: {
            name: "DiaryEntry",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: diary_entry_id -> diary_entries(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => diaryEntriesCollection,
                localKey: "diary_entry_id",
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
        icon: "MessageCircle",
        display: { title: "body" },
        // A board over "bodyFormat" fits this table, but a board needs a string column to keep each card's order in. Add one, then declare kanban: { columnProperty: "bodyFormat" } and orderProperty: "<that property>".,
        propertiesOrder: [
            "id",
            "bodyFormat",
            "visible",
            "diaryEntry",
            "user",
            "body",
            "createdAt",
            "updatedAt"
        ]
    }
});

export default diaryCommentsCollection;
