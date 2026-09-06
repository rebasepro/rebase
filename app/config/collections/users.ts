import { maskEmail, maskName, maskValues } from "../masking";
import type { PostgresCollectionConfig } from "@rebasepro/types";

const usersCollection: PostgresCollectionConfig = {
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
            },
            // Four short fields split into a 2×2 grid, which is a square of
            // unrelated values rather than a form. Full width, one column.
            admin: { span: 4 }
        },
        displayName: {
            name: "Name",
            type: "string",
            columnName: "display_name",
            admin: { span: 4 }
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
            admin: { span: 4 },
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
            admin: { readOnly: true,
span: 4 }
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
            using: "rebase.uid() IS NULL OR id = rebase.uid()::uuid OR string_to_array(rebase.roles(), ',') && ARRAY['admin']"
        },
        {
            name: "users_write_policy",
            operations: ["insert", "update", "delete"],
            using: "rebase.uid() IS NULL OR string_to_array(rebase.roles(), ',') && ARRAY['admin']",
            withCheck: "rebase.uid() IS NULL OR string_to_array(rebase.roles(), ',') && ARRAY['admin']"
        }
    ],
    admin: {
        icon: "Users",
        group: "Settings",
        openEntityMode: "dialog",
        disableDefaultActions: ["copy"],
        sort: ["createdAt", "desc"],
        // A user is called by their name. Without this the title is derived,
        // and `propertiesOrder` starting `["id", "email", …]` makes the
        // derivation take the email address — so every record was titled by
        // the address with the person's name sitting in the next field.
        //
        // No `image` role: `photoURL` is redacted to null by the `afterRead`
        // callback above, so pointing the thumbnail at it would name a column
        // that is empty by the time the panel sees it.
        display: {
            title: "displayName",
            subtitle: "email",
            date: "createdAt",
            tags: "roles"
        },
        listProperties: ["displayName", "email", "roles", "createdAt"],
        propertiesOrder: ["id", "email", "displayName", "roles", "createdAt"]
    }
};

export default usersCollection;
