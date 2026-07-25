import { maskEmail, maskName, maskValues } from "../masking";
import type { AdminCollectionConfig } from "@rebasepro/admin-types";

const usersCollection: AdminCollectionConfig = {
    name: "Users",
    singularName: "User",
    slug: "users",
    auth: true,
    table: "users",
    schema: "rebase",
    properties: {
        id: {
            name: "ID",
            type: "string",
            isId: "uuid",
            admin: { readOnly: true }
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
            admin: { readOnly: true }
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
    // Redact PII at the driver level (runs on REST, realtime, and `rebase.data`).
    callbacks: {
        afterRead: ({ row }) => maskValues(row, {
            email: maskEmail,
            displayName: maskName,
            photoURL: null
        })
    },
    securityRules: [
        {
            name: "users_read_policy",
            operation: "select",
            using: "auth.uid() IS NULL OR id = auth.uid()::uuid OR string_to_array(auth.roles(), ',') && ARRAY['admin']"
        },
        {
            name: "users_write_policy",
            operations: ["insert", "update", "delete"],
            using: "auth.uid() IS NULL OR string_to_array(auth.roles(), ',') && ARRAY['admin']",
            withCheck: "auth.uid() IS NULL OR string_to_array(auth.roles(), ',') && ARRAY['admin']"
        }
    ],
    admin: {
        icon: "Users",
        group: "Settings",
        openEntityMode: "dialog",
        disableDefaultActions: ["copy"],
        sort: ["createdAt", "desc"],
        listProperties: ["displayName", "email", "roles", "createdAt"],
        propertiesOrder: ["id", "email", "displayName", "roles", "createdAt"]
    }
};

export default usersCollection;
