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
        emailVerified: {
            hidden: true,
            hiddenInForm: true
        },
        emailVerificationSentAt: {
            hidden: true,
            hiddenInForm: true
        },
        isAnonymous: {
            hidden: true,
            hiddenInForm: true
        },
        metadata: {
            hidden: true,
            hiddenInForm: true
        },
        tokensValidAfter: {
            hidden: true,
            hiddenInForm: true
        },
        disabledAt: {
            name: "Disabled",
            readOnly: true
        },
        pendingEmail: {
            hidden: true,
            hiddenInForm: true
        },
        emailChangeToken: {
            hidden: true,
            hiddenInForm: true
        },
        emailChangeSentAt: {
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
