// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import usersCollection from "./users";

// Introspected as an owned-child: belongs to users (its only foreign key inside the primary key) and nothing else references it.

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "k" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "v" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.

const userPreferencesCollection = defineCollection({
    name: "User Preferences",
    singularName: "User Preference",
    slug: "user_preferences",
    table: "user_preferences",
    properties: {
        userId: {
            name: "User Id",
            columnName: "user_id",
            type: "number",
            // Part of composite primary key (user_id, k)
            isId: "manual",
            columnType: "bigint",
        },
        k: {
            name: "K",
            columnName: "k",
            type: "string",
            // Part of composite primary key (user_id, k)
            isId: "manual",
        },
        v: {
            name: "V",
            columnName: "v",
            type: "string",
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
    },
    admin: {
        icon: "Users",
        hideFromNavigation: true,
        display: { title: "v" },
        propertiesOrder: [
            "userId",
            "k",
            "v",
            "user"
        ]
    }
});

export default userPreferencesCollection;
