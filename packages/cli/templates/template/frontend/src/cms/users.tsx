import { customizeTable } from "@rebasepro/cms";
import type { users } from "../../../backend/schema/users";

export const usersCms = customizeTable<typeof users>("users", {
    icon: "Users",
    group: "Settings",
    openEntityMode: "dialog",
    disableDefaultActions: ["copy"],
    sort: ["createdAt", "desc"],
    fieldOrder: ["id", "email", "displayName", "roles", "createdAt"],
    fields: {
        id: {
            readOnly: true
        },
        displayName: {
            name: "Name"
        },
        photoURL: {
            urlPreview: "image"
        },
        roles: {
            of: {
                name: "Role"
            }
        },
        passwordHash: {
            hidden: true,
            hiddenInForm: true
        },
        emailVerified: {
            hidden: true,
            hiddenInForm: true
        },
        emailVerificationToken: {
            hidden: true,
            hiddenInForm: true
        },
        emailVerificationSentAt: {
            hidden: true,
            hiddenInForm: true
        },
        metadata: {
            hidden: true,
            hiddenInForm: true
        },
        createdAt: {
            readOnly: true
        },
        updatedAt: {
            hidden: true,
            hiddenInForm: true
        }
    }
});
