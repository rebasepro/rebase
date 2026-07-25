import authorsCollection from "./authors";
// Mutually recursive by design; the reference is only dereferenced inside the
// `target: () =>` thunk below, so module init order never matters.
// fallow-ignore-next-line circular-dependency
import tagsCollection from "./tags";
import type { AdminCollectionConfig } from "@rebasepro/admin-types";

const postsCollection: AdminCollectionConfig = {
    name: "Blog posts",
    singularName: "Blog post",
    slug: "posts",
    table: "posts",
    history: true,
    properties: {
        id: {
            name: "ID",
            type: "string",
            isId: "uuid"
        },
        title: {
            name: "Title",
            type: "string",
            validation: {
                required: true
            }
        },
        slug: {
            name: "Slug",
            type: "string",
            validation: {
                required: true,
                unique: true
            },
            description: "URL-friendly identifier for this blog post"
        },
        hero_image: {
            name: "Hero Image",
            type: "string",
            storage: {
                storagePath: "posts/hero/"
            },
            description: "Header image displayed at the top of the blog post"
        },
        excerpt: {
            name: "Excerpt",
            type: "string",
            admin: { multiline: true },
            description: "Short summary displayed in previews and cards",
            validation: {
                max: 300
            }
        },
        content: {
            name: "Content",
            type: "array",
            description: "Blog content as dynamic blocks of text and images",
            oneOf: {
                typeField: "type",
                valueField: "value",
                properties: {
                    text: {
                        name: "Text",
                        type: "string",
                        admin: { markdown: true }
                    },
                    image: {
                        name: "Image",
                        type: "string",
                        storage: {
                            storagePath: "posts/content/"
                        }
                    }
                }
            }
        },
        status: {
            name: "Status",
            type: "string",
            validation: {
                required: true
            },
            defaultValue: "draft",
            enum: [
                {
                    id: "draft",
                    label: "Draft",
                    color: "gray"
                },
                {
                    id: "needs_review",
                    label: "Needs Review",
                    color: "orange"
                },
                {
                    id: "published",
                    label: "Published",
                    color: "green"
                },
                {
                    id: "archived",
                    label: "Archived",
                    color: "red"
                }
            ]
        },
        publish_date: {
            name: "Publish date",
            type: "date",
            mode: "date_time",
            admin: { clearable: true },
            description: "When this post was or will be published"
        },
        created_at: {
            name: "Created at",
            type: "date",
            autoValue: "on_create",
            admin: {
                readOnly: true,
                hideFromCollection: true
            }
        },
        updated_at: {
            name: "Updated at",
            type: "date",
            autoValue: "on_update",
            admin: {
                readOnly: true,
                hideFromCollection: true
            }
        },
        author: {
            name: "Author",
            type: "relation",
            target: () => authorsCollection,
            cardinality: "one",
            direction: "owning"
        },
        tags: {
            name: "Tags",
            type: "relation",
            target: () => tagsCollection,
            cardinality: "many",
            direction: "owning"
        }
    },
    callbacks: {
        beforeSave: ({ values }) => {
            if (typeof values.title === "string" && !values.slug) {
                values.slug = values.title
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/(^-|-$)/g, "");
            }
            return values;
        }
    },
    admin: {
        icon: "FileText",
        group: "Content",
        defaultViewMode: "cards",
        enabledViews: ["table", "cards", "kanban"],
        kanban: {
            columnProperty: "status"
        },
        propertiesOrder: [
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
            "updated_at"
        ],
        entityViews: [
            "blog_preview"
        ],
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
        ]
    }
};

export default postsCollection;
