// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import usersCollection from "./users";
import changesetsCollection from "./changesets";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "created_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).

const changesetCommentsCollection = defineCollection({
    name: "Changeset Comments",
    singularName: "Changeset Comment",
    slug: "changeset_comments",
    table: "changeset_comments",
    properties: {
        id: {
            name: "Id",
            columnName: "id",
            type: "number",
            isId: "manual",
            columnType: "serial",
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
            validation: { required: true },
            // mapped from foreign key: author_id -> users(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => usersCollection,
                localKey: "author_id",
                onDelete: "no action"
            }
        },
        changeset: {
            name: "Changeset",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: changeset_id -> changesets(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => changesetsCollection,
                localKey: "changeset_id",
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
    },
    admin: {
        icon: "MessageCircle",
        display: { title: "body" },
        propertiesOrder: [
            "id",
            "visible",
            "author",
            "changeset",
            "body",
            "createdAt"
        ]
    }
});

export default changesetCommentsCollection;
