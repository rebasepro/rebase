import { PostgresCollection } from "@rebasepro/types";

export const defaultUsersCollection: PostgresCollection = {
    name: "Users",
    singularName: "User",
    slug: "users",
    table: "users",
    icon: "Users",
    group: "Settings",
    properties: {
        id: {
            name: "ID",
            type: "string",
            isId: "uuid"
        },
        email: {
            name: "Email",
            type: "string",
            validation: { required: true, unique: true }
        },
        password_hash: {
            name: "Password Hash",
            type: "string",
            ui: { hideFromCollection: true }
        },
        display_name: {
            name: "Display Name",
            type: "string"
        },
        photo_url: {
            name: "Photo URL",
            type: "string"
        },
        email_verified: {
            name: "Email Verified",
            type: "boolean",
            defaultValue: false
        },
        email_verification_token: {
            name: "Email Verification Token",
            type: "string",
            ui: { hideFromCollection: true }
        },
        email_verification_sent_at: {
            name: "Email Verification Sent At",
            type: "date",
            ui: { hideFromCollection: true }
        },
        metadata: {
            name: "Metadata",
            type: "map",
            defaultValue: {},
            ui: { hideFromCollection: true }
        },
        created_at: {
            name: "Created At",
            type: "date",
            autoValue: "on_create",
            ui: { readOnly: true, hideFromCollection: true }
        },
        updated_at: {
            name: "Updated At",
            type: "date",
            autoValue: "on_update",
            ui: { readOnly: true, hideFromCollection: true }
        }
    }
};
