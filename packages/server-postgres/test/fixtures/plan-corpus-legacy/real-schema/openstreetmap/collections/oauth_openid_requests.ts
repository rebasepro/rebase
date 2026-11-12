// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import oauthAccessGrantsCollection from "./oauth_access_grants";

// Introspected as an owned-child: belongs to oauth_access_grants (its only ON DELETE CASCADE foreign key) and nothing else references it.

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "nonce" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.

const oauthOpenidRequestsCollection = defineCollection({
    name: "Oauth Openid Requests",
    singularName: "Oauth Openid Request",
    slug: "oauth_openid_requests",
    table: "oauth_openid_requests",
    properties: {
        id: {
            name: "Id",
            columnName: "id",
            type: "number",
            isId: "manual",
            columnType: "bigserial",
        },
        nonce: {
            name: "Nonce",
            columnName: "nonce",
            type: "string",
            validation: {
                required: true
            },
        },
        accessGrant: {
            name: "AccessGrant",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: access_grant_id -> oauth_access_grants(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => oauthAccessGrantsCollection,
                localKey: "access_grant_id",
                onDelete: "cascade"
            }
        },
    },
    admin: {
        icon: "Database",
        hideFromNavigation: true,
        display: { title: "nonce" },
        propertiesOrder: [
            "id",
            "nonce",
            "accessGrant"
        ]
    }
});

export default oauthOpenidRequestsCollection;
