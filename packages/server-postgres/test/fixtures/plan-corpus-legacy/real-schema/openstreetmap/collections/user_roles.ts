// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import usersCollection from "./users";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "role" uses the enum type "user_role_enum", which other columns share; Rebase gives each column its own type (<table>_<column>), so a push would plan "user_roles_role" and a conversion Postgres cannot cast.
//   - "created_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "updated_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).

const userRolesCollection = defineCollection({
    name: "User Roles",
    singularName: "User Role",
    slug: "user_roles",
    table: "user_roles",
    properties: {
        id: {
            name: "Id",
            columnName: "id",
            type: "number",
            isId: "manual",
            columnType: "serial",
        },
        role: {
            name: "Role",
            columnName: "role",
            type: "string",
            enum: [{ id: "administrator", label: "Administrator" }, { id: "moderator", label: "Moderator" }, { id: "importer", label: "Importer" }],
            validation: {
                required: true
            },
        },
        granter: {
            name: "Granter",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: granter_id -> users(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => usersCollection,
                localKey: "granter_id",
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
        // A board over "role" fits this table, but a board needs a string column to keep each card's order in. Add one, then declare kanban: { columnProperty: "role" } and orderProperty: "<that property>".,
        propertiesOrder: [
            "id",
            "role",
            "granter",
            "user",
            "createdAt",
            "updatedAt"
        ]
    }
});

export default userRolesCollection;
