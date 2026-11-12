// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import oauthApplicationsCollection from "./oauth_applications";
import usersCollection from "./users";

// Introspected as an owned-child: belongs to oauth_applications (its only NOT NULL foreign key) and nothing else references it.

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "token" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "refresh_token" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "revoked_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "created_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "scopes" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "previous_refresh_token" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.

const oauthAccessTokensCollection = defineCollection({
    name: "Oauth Access Tokens",
    singularName: "Oauth Access Token",
    slug: "oauth_access_tokens",
    table: "oauth_access_tokens",
    properties: {
        id: {
            name: "Id",
            columnName: "id",
            type: "number",
            isId: "manual",
            columnType: "bigserial",
        },
        token: {
            name: "Token",
            columnName: "token",
            type: "string",
            validation: {
                required: true,
                unique: true
            },
        },
        refreshToken: {
            name: "Refresh Token",
            columnName: "refresh_token",
            type: "string",
            validation: {
                unique: true
            },
        },
        scopes: {
            name: "Scopes",
            columnName: "scopes",
            type: "string",
        },
        previousRefreshToken: {
            name: "Previous Refresh Token",
            columnName: "previous_refresh_token",
            type: "string",
            defaultValue: "",
            validation: {
                required: true
            },
        },
        expiresIn: {
            name: "Expires In",
            columnName: "expires_in",
            type: "number",
            columnType: "integer",
        },
        revokedAt: {
            name: "Revoked At",
            columnName: "revoked_at",
            type: "date",
        },
        application: {
            name: "Application",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: application_id -> oauth_applications(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => oauthApplicationsCollection,
                localKey: "application_id",
                onDelete: "no action"
            }
        },
        resourceOwner: {
            name: "ResourceOwner",
            type: "relation",
            // mapped from foreign key: resource_owner_id -> users(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => usersCollection,
                localKey: "resource_owner_id",
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
            validation: {
                required: true
            },
        },
    },
    admin: {
        icon: "Database",
        hideFromNavigation: true,
        display: { title: "token" },
        listProperties: [
            "id",
            "token",
            "refreshToken",
            "scopes",
            "previousRefreshToken",
            "expiresIn"
        ],
        propertiesOrder: [
            "id",
            "token",
            "refreshToken",
            "scopes",
            "previousRefreshToken",
            "expiresIn",
            "revokedAt",
            "application",
            "resourceOwner",
            "createdAt"
        ]
    }
});

export default oauthAccessTokensCollection;
