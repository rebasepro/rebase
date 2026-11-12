import { customizeTable } from "@rebasepro/cms";
import type { authors } from "../../../backend/schema/authors";
import { text, openInNewTab } from "./lib/actions";
import { joinParts } from "./lib/display";

export const authorsCms = customizeTable<typeof authors>("authors", {
    icon: "User",
    group: "Content",
    entityActions: [
        {
            key: "email",
            name: "Email author",
            icon: "Mail",
            collapsed: false,
            isEnabled: ({ row }) => Boolean(text(row?.email)),
            disabledReason: () => "No email on file",
            onClick: ({ row }) => {
                if (row) openInNewTab(`mailto:${String(row.email)}`);
            }
        },
        {
            key: "open_website",
            name: "Open website",
            icon: "Globe",
            isEnabled: ({ row }) => Boolean(text(row?.website)),
            disabledReason: () => "No website on this author",
            onClick: ({ row }) => {
                if (row) openInNewTab(String(row.website));
            }
        },
        {
            key: "open_github",
            name: "Open GitHub profile",
            icon: "ExternalLink",
            isEnabled: ({ row }) => Boolean(text(row?.github)),
            disabledReason: () => "No GitHub profile on this author",
            onClick: ({ row }) => {
                if (!row) return;
                const handle = String(row.github);
                openInNewTab(handle.startsWith("http") ? handle : `https://github.com/${handle.replace(/^@/, "")}`);
            }
        }
    ],
    display: {
        title: "name",
        subtitle: ({ row }) => joinParts(row.email, row.twitter),
        image: "picture"
    },
    form: {
        sections: [
            {
                key: "author",
                fields: ["picture", "name", "email", "bio"]
            },
            {
                key: "links",
                title: "Links",
                fields: ["twitter", "github", "website"]
            }
        ]
    },
    fieldOrder: ["id", "name", "email", "picture", "bio", "twitter", "github", "website", "userId"],
    sort: ["name", "asc"],
    fields: {
        bio: {
            markdown: true
        },
        twitter: {
            name: "Twitter / X"
        },
        github: {
            name: "GitHub"
        },
        userId: {
            name: "Linked User"
        }
    }
});
