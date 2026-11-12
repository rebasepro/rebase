// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import usersCollection from "./users";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "title" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "created_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "updated_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "description_format" uses the enum type "format_enum", which other columns share; Rebase gives each column its own type (<table>_<column>), so a push would plan "redactions_description_format" and a conversion Postgres cannot cast.

const redactionsCollection = defineCollection({
    name: "Redactions",
    singularName: "Redaction",
    slug: "redactions",
    table: "redactions",
    properties: {
        id: {
            name: "Id",
            columnName: "id",
            type: "number",
            isId: "manual",
            columnType: "serial",
        },
        title: {
            name: "Title",
            columnName: "title",
            type: "string",
            validation: {
                required: true
            },
        },
        descriptionFormat: {
            name: "Description Format",
            columnName: "description_format",
            type: "string",
            enum: [{ id: "html", label: "Html" }, { id: "markdown", label: "Markdown" }, { id: "text", label: "Text" }],
            defaultValue: "markdown",
            validation: {
                required: true
            },
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
        description: {
            name: "Description",
            columnName: "description",
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
        display: { title: "title" },
        // A board over "descriptionFormat" fits this table, but a board needs a string column to keep each card's order in. Add one, then declare kanban: { columnProperty: "descriptionFormat" } and orderProperty: "<that property>".,
        propertiesOrder: [
            "id",
            "title",
            "descriptionFormat",
            "user",
            "description",
            "createdAt",
            "updatedAt"
        ]
    }
});

export default redactionsCollection;
