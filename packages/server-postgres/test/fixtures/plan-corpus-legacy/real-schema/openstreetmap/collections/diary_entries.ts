// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import languagesCollection from "./languages";
import usersCollection from "./users";
import diaryCommentsCollection from "./diary_comments";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "title" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "created_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "updated_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "body_format" uses the enum type "format_enum", which other columns share; Rebase gives each column its own type (<table>_<column>), so a push would plan "diary_entries_body_format" and a conversion Postgres cannot cast.

const diaryEntriesCollection = defineCollection({
    name: "Diary Entries",
    singularName: "Diary Entry",
    slug: "diary_entries",
    table: "diary_entries",
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
        visible: {
            name: "Visible",
            columnName: "visible",
            type: "boolean",
            defaultValue: true,
            validation: {
                required: true
            },
        },
        latitude: {
            name: "Latitude",
            columnName: "latitude",
            type: "number",
            columnType: "double precision",
        },
        longitude: {
            name: "Longitude",
            columnName: "longitude",
            type: "number",
            columnType: "double precision",
        },
        languageCode: {
            name: "LanguageCode",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: language_code -> languages(code)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => languagesCollection,
                localKey: "language_code",
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
    relations: [
        {
            kind: "hasMany",
            relationName: "diary_comments",
            target: (): AnyCollectionConfig => diaryCommentsCollection,
            // the diary_comments.diary_entry_id FK points back here
            foreignKeyOnTarget: "diary_entry_id"
        },
        // The many-to-many with users through diary_entry_subscriptions is declared on
        // users only: declaring it here too would re-key diary_entry_subscriptions
        // from (user_id, diary_entry_id) on the next push.
    ],
    admin: {
        icon: "Database",
        display: { title: "title" },
        // A board over "bodyFormat" fits this table, but a board needs a string column to keep each card's order in. Add one, then declare kanban: { columnProperty: "bodyFormat" } and orderProperty: "<that property>".,
        listProperties: [
            "id",
            "title",
            "bodyFormat",
            "visible",
            "latitude",
            "longitude"
        ],
        propertiesOrder: [
            "id",
            "title",
            "bodyFormat",
            "visible",
            "latitude",
            "longitude",
            "languageCode",
            "user",
            "body",
            "createdAt",
            "updatedAt"
        ]
    }
});

export default diaryEntriesCollection;
