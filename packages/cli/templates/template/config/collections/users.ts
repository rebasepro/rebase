import { EntityCollection } from "@rebasepro/types";
import { resetPasswordAction, deleteEntityAction, RolesFilterSelect, UserRolesSelectField } from "@rebasepro/admin";
import rolesCollection from "./roles.js";

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
    Actions: [RolesFilterSelect],
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
            ui: {
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
            validation: {
                required: true
            }
        },
        photoURL: {
            name: "Photo URL",
            type: "string",
            url: "image"
        },
        roles: {
            name: "Roles",
            type: "relation",
            target: () => rolesCollection,
            cardinality: "many",
            direction: "owning",
            through: {
                table: "user_roles",
                sourceColumn: "user_id",
                targetColumn: "role_id"
            },
            ui: {
                Field: UserRolesSelectField
            }
        },
        passwordHash: {
            name: "Password Hash",
            type: "string",
            columnName: "password_hash",
            ui: {
                hideFromCollection: true,
                disabled: { hidden: true }
            }
        },
        emailVerified: {
            name: "Email Verified",
            type: "boolean",
            columnName: "email_verified",
            defaultValue: false,
            ui: {
                hideFromCollection: true,
                disabled: { hidden: true }
            }
        },
        emailVerificationToken: {
            name: "Email Verification Token",
            type: "string",
            columnName: "email_verification_token",
            ui: {
                hideFromCollection: true,
                disabled: { hidden: true }
            }
        },
        emailVerificationSentAt: {
            name: "Email Verification Sent At",
            type: "date",
            columnName: "email_verification_sent_at",
            ui: {
                hideFromCollection: true,
                disabled: { hidden: true }
            }
        },
        metadata: {
            name: "Metadata",
            type: "map",
            defaultValue: {},
            ui: {
                hideFromCollection: true,
                disabled: { hidden: true }
            }
        },
        createdAt: {
            name: "Created At",
            type: "date",
            ui: {
                readOnly: true
            }
        },
        updatedAt: {
            name: "Updated At",
            type: "date",
            columnName: "updated_at",
            autoValue: "on_update",
            ui: {
                hideFromCollection: true,
                disabled: { hidden: true }
            }
        }
    },
    propertiesOrder: [
        "id",
        "email",
        "displayName",
        "roles",
        "createdAt"
    ]
};

export default usersCollection;
