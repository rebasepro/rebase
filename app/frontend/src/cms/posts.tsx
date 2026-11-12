import { customizeTable } from "@rebasepro/cms";
import type { posts } from "../../../backend/schema/posts";
import { updateRecord } from "./lib/actions";
import { includedRows } from "./lib/display";

export const postsCms = customizeTable<typeof posts>("posts", {
    name: "Blog posts",
    singularName: "Blog post",
    icon: "FileText",
    group: "Content",
    entityActions: [
        {
            key: "publish",
            name: "Publish",
            icon: "Send",
            collapsed: false,
            isEnabled: ({ row }) => row?.status !== "published",
            disabledReason: () => "Already published",
            onClick: ({ row, id, path, context, collection }) => row &&
                updateRecord(context, collection?.slug ?? path, id,
                    { status: "published", publish_date: new Date().toISOString() }, "Post published")
        },
        {
            key: "request_review",
            name: "Request review",
            icon: "MessageSquare",
            isEnabled: ({ row }) => row?.status === "draft",
            disabledReason: ({ row }) => row?.status === "published"
                ? "Already published"
                : "Already waiting for review",
            onClick: ({ row, id, path, context, collection }) => row &&
                updateRecord(context, collection?.slug ?? path, id, { status: "needs_review" }, "Sent for review")
        },
        {
            key: "unpublish",
            name: "Unpublish",
            icon: "EyeOff",
            isEnabled: ({ row }) => row?.status === "published",
            disabledReason: () => "This post is not published",
            onClick: ({ row, id, path, context, collection }) => row &&
                updateRecord(context, collection?.slug ?? path, id, { status: "draft" }, "Post moved back to drafts")
        }
    ],
    defaultViewMode: "cards",
    display: {
        title: "title",
        subtitle: "excerpt",
        image: "hero_image",
        status: "status",
        date: "publish_date",
        tags: ({ row }) => includedRows(row.tags)
            .map(tag => String(tag.name ?? ""))
            .filter(Boolean)
    },
    form: {
        sidebar: ["status", "publish_date", "author", "tags"],
        sections: [
            {
                key: "post",
                fields: ["title", "slug", "hero_image", "excerpt"]
            },
            {
                key: "body",
                title: "Content",
                fields: ["content"]
            }
        ]
    },
    kanban: {
        columnField: "status",
        orderField: "__order"
    },
    fieldOrder: [
        "title",
        "slug",
        "hero_image",
        "excerpt",
        "status",
        "publish_date",
        "author",
        "tags",
        "content",
        "created_at",
        "updated_at",
        "__order"
    ],
    entityViews: ["blog_preview"],
    filterPresets: [
        {
            label: "Published",
            filterValues: {
                status: ["==", "published"]
            },
            sort: ["publish_date", "desc"]
        },
        {
            label: "Drafts",
            filterValues: {
                status: ["==", "draft"]
            }
        },
        {
            label: "Needs review",
            filterValues: {
                status: ["==", "needs_review"]
            }
        },
        {
            label: "Archived",
            filterValues: {
                status: ["==", "archived"]
            }
        }
    ],
    fields: {
        slug: {
            filledByServer: true
        },
        excerpt: {
            multiline: true
        },
        content: {
            oneOf: {
                text: {
                    markdown: true
                }
            }
        },
        status: {
            enumLabels: {
                draft: {
                    label: "Draft",
                    color: "gray"
                },
                needs_review: {
                    label: "Needs Review",
                    color: "orange"
                },
                published: {
                    label: "Published",
                    color: "green"
                },
                archived: {
                    label: "Archived",
                    color: "red"
                }
            }
        },
        publish_date: {
            name: "Publish date",
            mode: "date_time",
            clearable: true
        },
        created_at: {
            name: "Created at",
            readOnly: true,
            hidden: true
        },
        updated_at: {
            name: "Updated at",
            readOnly: true,
            hidden: true
        },
        __order: {
            disabled: true,
            hidden: true
        }
    }
});
