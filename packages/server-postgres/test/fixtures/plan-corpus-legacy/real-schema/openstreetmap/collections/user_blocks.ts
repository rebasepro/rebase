// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import usersCollection from "./users";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "ends_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "created_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "updated_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "reason_format" uses the enum type "format_enum", which other columns share; Rebase gives each column its own type (<table>_<column>), so a push would plan "user_blocks_reason_format" and a conversion Postgres cannot cast.
//   - "deactivates_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).

const userBlocksCollection = defineCollection({
    name: "User Blocks",
    singularName: "User Block",
    slug: "user_blocks",
    table: "user_blocks",
    properties: {
        id: {
            name: "Id",
            columnName: "id",
            type: "number",
            isId: "manual",
            columnType: "serial",
        },
        reasonFormat: {
            name: "Reason Format",
            columnName: "reason_format",
            type: "string",
            enum: [{ id: "html", label: "Html" }, { id: "markdown", label: "Markdown" }, { id: "text", label: "Text" }],
            defaultValue: "markdown",
            validation: {
                required: true
            },
        },
        needsView: {
            name: "Needs View",
            columnName: "needs_view",
            type: "boolean",
            defaultValue: false,
            validation: {
                required: true
            },
        },
        endsAt: {
            name: "Ends At",
            columnName: "ends_at",
            type: "date",
            validation: {
                required: true
            },
        },
        deactivatesAt: {
            name: "Deactivates At",
            columnName: "deactivates_at",
            type: "date",
        },
        creator: {
            name: "Creator",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: creator_id -> users(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => usersCollection,
                localKey: "creator_id",
                onDelete: "no action"
            }
        },
        revoker: {
            name: "Revoker",
            type: "relation",
            // mapped from foreign key: revoker_id -> users(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => usersCollection,
                localKey: "revoker_id",
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
        reason: {
            name: "Reason",
            columnName: "reason",
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
        icon: "Users",
        display: { title: "reason" },
        // A board over "reasonFormat" fits this table, but a board needs a string column to keep each card's order in. Add one, then declare kanban: { columnProperty: "reasonFormat" } and orderProperty: "<that property>".,
        listProperties: [
            "id",
            "reasonFormat",
            "needsView",
            "endsAt",
            "deactivatesAt",
            "creator"
        ],
        propertiesOrder: [
            "id",
            "reasonFormat",
            "needsView",
            "endsAt",
            "deactivatesAt",
            "creator",
            "revoker",
            "user",
            "reason",
            "createdAt",
            "updatedAt"
        ]
    }
});

export default userBlocksCollection;
