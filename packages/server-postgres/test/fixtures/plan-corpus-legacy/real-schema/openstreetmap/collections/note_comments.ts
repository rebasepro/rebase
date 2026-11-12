// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import usersCollection from "./users";
import notesCollection from "./notes";

// Introspected as an owned-child: belongs to notes (its only NOT NULL foreign key) and nothing else references it.

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "created_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "author_ip" is inet, which no property type stores; it is read as text, and a push would plan converting the column to text.
//   - "event" uses the enum type "note_event_enum", and Rebase names a column's enum type <table>_<column>. Rename it before pushing: ALTER TYPE "note_event_enum" RENAME TO "note_comments_event";

const noteCommentsCollection = defineCollection({
    name: "Note Comments",
    singularName: "Note Comment",
    slug: "note_comments",
    table: "note_comments",
    properties: {
        id: {
            name: "Id",
            columnName: "id",
            type: "number",
            isId: "manual",
            columnType: "bigserial",
        },
        event: {
            name: "Event",
            columnName: "event",
            type: "string",
            enum: [{ id: "opened", label: "Opened" }, { id: "closed", label: "Closed" }, { id: "reopened", label: "Reopened" }, { id: "commented", label: "Commented" }, { id: "hidden", label: "Hidden" }],
        },
        authorIp: {
            name: "Author Ip",
            columnName: "author_ip",
            type: "string",
        },
        visible: {
            name: "Visible",
            columnName: "visible",
            type: "boolean",
            validation: {
                required: true
            },
        },
        author: {
            name: "Author",
            type: "relation",
            // mapped from foreign key: author_id -> users(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => usersCollection,
                localKey: "author_id",
                onDelete: "no action"
            }
        },
        note: {
            name: "Note",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: note_id -> notes(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => notesCollection,
                localKey: "note_id",
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
    },
    admin: {
        icon: "MessageCircle",
        hideFromNavigation: true,
        listProperties: [
            "id",
            "event",
            "authorIp",
            "visible",
            "author",
            "note"
        ],
        propertiesOrder: [
            "id",
            "event",
            "authorIp",
            "visible",
            "author",
            "note",
            "body",
            "createdAt"
        ]
    }
});

export default noteCommentsCollection;
