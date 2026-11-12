// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import usersCollection from "./users";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "created_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).

const friendsCollection = defineCollection({
    name: "Friends",
    singularName: "Friend",
    slug: "friends",
    table: "friends",
    properties: {
        id: {
            name: "Id",
            columnName: "id",
            type: "number",
            isId: "manual",
            columnType: "bigserial",
        },
        friendUser: {
            name: "FriendUser",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: friend_user_id -> users(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => usersCollection,
                localKey: "friend_user_id",
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
    },
    admin: {
        icon: "Database",
        propertiesOrder: [
            "id",
            "friendUser",
            "user",
            "createdAt"
        ]
    }
});

export default friendsCollection;
