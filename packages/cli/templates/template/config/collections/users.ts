import { defineCollection } from "@rebasepro/cms-types";

const usersCollection = defineCollection({
    name: "Users",
    singularName: "User",
    slug: "users",
    auth: { enabled: true },
    table: "users",
    schema: "rebase",
    securityRules: [
        {
            operation: "select",
            roles: ["admin"]
        },
        {
            operations: ["insert", "update", "delete"],
            roles: ["admin"]
        }
    ],
    properties: {
        id: {
            name: "ID",
            type: "string",
            isId: "uuid",
            admin: {
                readOnly: true
            }
        },
        email: {
            name: "Email",
            type: "string",
            validation: {
                required: true,
                unique: true
            }
        },
        displayName: {
            name: "Name",
            type: "string",
            columnName: "display_name"
        },
        photoURL: {
            name: "Photo URL",
            type: "string",
            columnName: "photo_url",
            url: true,
            admin: { urlPreview: "image" }
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
            excludeFromApi: true,
            admin: {
                hideFromCollection: true,
                disabled: { hidden: true }
            }
        },
        emailVerified: {
            name: "Email Verified",
            type: "boolean",
            columnName: "email_verified",
            defaultValue: false,
            admin: {
                hideFromCollection: true,
                disabled: { hidden: true }
            }
        },
        emailVerificationToken: {
            name: "Email Verification Token",
            type: "string",
            columnName: "email_verification_token",
            excludeFromApi: true,
            admin: {
                hideFromCollection: true,
                disabled: { hidden: true }
            }
        },
        emailVerificationSentAt: {
            name: "Email Verification Sent At",
            type: "date",
            columnName: "email_verification_sent_at",
            admin: {
                hideFromCollection: true,
                disabled: { hidden: true }
            }
        },
        metadata: {
            name: "Metadata",
            type: "map",
            keyValue: true,
            properties: {},
            defaultValue: {},
            admin: {
                hideFromCollection: true,
                disabled: { hidden: true }
            }
        },
        createdAt: {
            name: "Created At",
            type: "date",
            columnName: "created_at",
            autoValue: "on_create",
            admin: {
                readOnly: true
            }
        },
        updatedAt: {
            name: "Updated At",
            type: "date",
            columnName: "updated_at",
            autoValue: "on_update",
            admin: {
                hideFromCollection: true,
                disabled: { hidden: true }
            }
        }
    },
    admin: {
        icon: "Users",
        group: "Settings",
        openEntityMode: "dialog",
        disableDefaultActions: ["copy"],
        sort: ["createdAt", "desc"],
        propertiesOrder: [
            "id",
            "email",
            "displayName",
            "roles",
            "createdAt"
        ]
    }
});

export default usersCollection;
