import type { EntityCollection } from "@rebasepro/types";
import { resetPasswordAction, deleteEntityAction } from "@rebasepro/admin";

const usersCollection: EntityCollection = {
    name: "Users",
    singularName: "User",
    slug: "users",
    table: "users",
    schema: "rebase",
    icon: "Users",
    group: "Settings",
    openEntityMode: "dialog",
    disableDefaultActions: ["copy"],
    entityActions: [
        resetPasswordAction,
        {
            ...deleteEntityAction,
            collapsed: false
        }
    ],
    sort: ["createdAt", "desc"],
    properties: {
        id: {
            name: "ID",
            type: "string",
            isId: "uuid",
            ui: { readOnly: true }
        },
        email: {
            name: "Email",
            type: "string",
            validation: { required: true, unique: true }
        },
        displayName: {
            name: "Name",
            type: "string",
            columnName: "display_name",
            validation: { required: true }
        },
        photoURL: {
            name: "Photo URL",
            type: "string",
            columnName: "photo_url",
            url: "image"
        },
        roles: {
            name: "Roles",
            type: "array",
            columnType: "text[]",
            of: {
                name: "Role",
                type: "string",
                enum: {
                    admin: "Admin",
                    editor: "Editor",
                    viewer: "Viewer"
                }
            }
        },
        passwordHash: {
            name: "Password Hash",
            type: "string",
            columnName: "password_hash",
            ui: { hideFromCollection: true, disabled: { hidden: true } }
        },
        emailVerified: {
            name: "Email Verified",
            type: "boolean",
            columnName: "email_verified",
            defaultValue: false,
            ui: { hideFromCollection: true, disabled: { hidden: true } }
        },
        emailVerificationToken: {
            name: "Email Verification Token",
            type: "string",
            columnName: "email_verification_token",
            ui: { hideFromCollection: true, disabled: { hidden: true } }
        },
        emailVerificationSentAt: {
            name: "Email Verification Sent At",
            type: "date",
            columnName: "email_verification_sent_at",
            ui: { hideFromCollection: true, disabled: { hidden: true } }
        },
        metadata: {
            name: "Metadata",
            type: "map",
            defaultValue: {},
            ui: { hideFromCollection: true, disabled: { hidden: true } }
        },
        createdAt: {
            name: "Created At",
            type: "date",
            columnName: "created_at",
            ui: { readOnly: true }
        },
        updatedAt: {
            name: "Updated At",
            type: "date",
            columnName: "updated_at",
            autoValue: "on_update",
            ui: { hideFromCollection: true, disabled: { hidden: true } }
        }
    },
    listProperties: ["displayName", "email", "roles", "createdAt"],
    propertiesOrder: ["id", "email", "displayName", "roles", "createdAt"]
};

export default usersCollection;
