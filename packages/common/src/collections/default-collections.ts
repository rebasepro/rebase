import { defineCollection } from "../util/builders";

/**
 * Default users collection.
 *
 * Prepended to the developer's collections array by the admin and server.
 * Slug-based dedup (Map keyed by slug, last-write-wins) lets developers
 * override by defining their own collection with `slug: "users"`.
 *
 * Schema only — no `admin` block. This package is on the backend's dependency path,
 * where that field does not exist: `@rebasepro/cms-types` adds it by declaration
 * merging, and a BaaS install never installs that. The scaffolded
 * `config/collections/users.ts` carries the presentation for projects that want this
 * collection in their panel, which is also where it is editable.
 */
export const defaultUsersCollection = defineCollection({
    name: "Users",
    singularName: "User",
    slug: "users",
    auth: true,
    table: "users",
    schema: "rebase",
    securityRules: [
        { operation: "select",
roles: ["admin"] },
        { operations: ["insert", "update", "delete"],
roles: ["admin"] }
    ],
    properties: {
        id: {
            name: "ID",
            type: "string",
            isId: "uuid"
        },
        email: {
            name: "Email",
            type: "string",
            validation: { required: true,
unique: true }
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
            columnName: "photo_url"
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
            excludeFromApi: true
        },
        emailVerified: {
            name: "Email Verified",
            type: "boolean",
            columnName: "email_verified",
            defaultValue: false
        },
        emailVerificationToken: {
            name: "Email Verification Token",
            type: "string",
            columnName: "email_verification_token",
            excludeFromApi: true
        },
        emailVerificationSentAt: {
            name: "Email Verification Sent At",
            type: "date",
            columnName: "email_verification_sent_at"
        },
        metadata: {
            name: "Metadata",
            type: "map",
            keyValue: true,
            properties: {},
            defaultValue: {}
        },
        createdAt: {
            name: "Created At",
            type: "date",
            columnName: "created_at",
            autoValue: "on_create"
        },
        updatedAt: {
            name: "Updated At",
            type: "date",
            columnName: "updated_at",
            autoValue: "on_update"
        }
    }
});
