// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import usersCollection from "./users";
import oauthApplicationsCollection from "./oauth_applications";
import oauthOpenidRequestsCollection from "./oauth_openid_requests";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "token" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "created_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "revoked_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "scopes" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "code_challenge" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "code_challenge_method" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.

const oauthAccessGrantsCollection = defineCollection({
    name: "Oauth Access Grants",
    singularName: "Oauth Access Grant",
    slug: "oauth_access_grants",
    table: "oauth_access_grants",
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
        scopes: {
            name: "Scopes",
            columnName: "scopes",
            type: "string",
            defaultValue: "",
            validation: {
                required: true
            },
        },
        codeChallenge: {
            name: "Code Challenge",
            columnName: "code_challenge",
            type: "string",
        },
        codeChallengeMethod: {
            name: "Code Challenge Method",
            columnName: "code_challenge_method",
            type: "string",
        },
        expiresIn: {
            name: "Expires In",
            columnName: "expires_in",
            type: "number",
            columnType: "integer",
            validation: {
                required: true
            },
        },
        revokedAt: {
            name: "Revoked At",
            columnName: "revoked_at",
            type: "date",
        },
        resourceOwner: {
            name: "ResourceOwner",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: resource_owner_id -> users(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => usersCollection,
                localKey: "resource_owner_id",
                onDelete: "no action"
            }
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
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "oauth_openid_requests",
            target: (): AnyCollectionConfig => oauthOpenidRequestsCollection,
            // the oauth_openid_requests.access_grant_id FK points back here
            foreignKeyOnTarget: "access_grant_id"
        },
    ],
    admin: {
        icon: "Database",
        display: { title: "token" },
        listProperties: [
            "id",
            "token",
            "scopes",
            "codeChallenge",
            "codeChallengeMethod",
            "expiresIn"
        ],
        propertiesOrder: [
            "id",
            "token",
            "scopes",
            "codeChallenge",
            "codeChallengeMethod",
            "expiresIn",
            "revokedAt",
            "resourceOwner",
            "application",
            "redirectUri",
            "createdAt"
        ]
    }
});

export default oauthAccessGrantsCollection;
