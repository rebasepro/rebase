import { customizeTable } from "@rebasepro/cms";
import type { users } from "../../../backend/schema/users";
import { text, copyToClipboard } from "./lib/actions";

export const usersCms = customizeTable<typeof users>("users", {
    icon: "Users",
    group: "Settings",
    entityActions: [
        {
            key: "copy_email",
            name: "Copy email address",
            icon: "ClipboardCopy",
            isEnabled: ({ row }) => Boolean(text(row?.email)),
            disabledReason: () => "No email on file",
            onClick: ({ row, context }) => row &&
                copyToClipboard(context, String(row.email), "Email address copied")
        }
    ],
    openEntityMode: "dialog",
    disableDefaultActions: ["copy"],
    sort: [
        ["roles", "desc"],
        ["createdAt", "desc"]
    ],
    display: {
        title: "displayName",
        subtitle: "email",
        date: "createdAt",
        tags: "roles"
    },
    listFields: ["displayName", "email", "roles", "createdAt"],
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
