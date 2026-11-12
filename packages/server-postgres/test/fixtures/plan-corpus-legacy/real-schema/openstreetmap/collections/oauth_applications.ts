// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import usersCollection from "./users";
import oauthAccessGrantsCollection from "./oauth_access_grants";
import oauthAccessTokensCollection from "./oauth_access_tokens";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "owner_type" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "name" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "uid" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "secret" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "scopes" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "created_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "updated_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).

const oauthApplicationsCollection = defineCollection({
    name: "Oauth Applications",
    singularName: "Oauth Application",
    slug: "oauth_applications",
    table: "oauth_applications",
    properties: {
        id: {
            name: "Id",
            columnName: "id",
            type: "number",
            isId: "manual",
            columnType: "bigserial",
        },
        name: {
            name: "Name",
            columnName: "name",
            type: "string",
            validation: {
                required: true
            },
        },
        ownerType: {
            name: "Owner Type",
            columnName: "owner_type",
            type: "string",
            validation: {
                required: true
            },
        },
        uid: {
            name: "Uid",
            columnName: "uid",
            type: "string",
            validation: {
                required: true,
                unique: true
            },
        },
        secret: {
            name: "Secret",
            columnName: "secret",
            type: "string",
            validation: {
                required: true
            },
        },
        scopes: {
            name: "Scopes",
            columnName: "scopes",
            type: "string",
            defaultValue: "",
            validation: {
                required: true
            },
        },
        confidential: {
            name: "Confidential",
            columnName: "confidential",
            type: "boolean",
            defaultValue: true,
            validation: {
                required: true
            },
        },
        owner: {
            name: "Owner",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: owner_id -> users(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => usersCollection,
                localKey: "owner_id",
                onDelete: "no action"
            }
        },
        redirectUri: {
            name: "Redirect Uri",
            columnName: "redirect_uri",
            type: "string",
            url: true,
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
            relationName: "oauth_access_grants",
            target: (): AnyCollectionConfig => oauthAccessGrantsCollection,
            // the oauth_access_grants.application_id FK points back here
            foreignKeyOnTarget: "application_id"
        },
        {
            kind: "hasMany",
            relationName: "oauth_access_tokens",
            target: (): AnyCollectionConfig => oauthAccessTokensCollection,
            // the oauth_access_tokens.application_id FK points back here
            foreignKeyOnTarget: "application_id"
        },
    ],
    admin: {
        icon: "Database",
        display: { title: "uid" },
        listProperties: [
            "id",
            "name",
            "ownerType",
            "uid",
            "secret",
            "scopes"
        ],
        propertiesOrder: [
            "id",
            "name",
            "ownerType",
            "uid",
            "secret",
            "scopes",
            "confidential",
            "owner",
            "redirectUri",
            "createdAt",
            "updatedAt"
        ]
    }
});

export default oauthApplicationsCollection;
