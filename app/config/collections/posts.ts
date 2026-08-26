import authorsCollection from "./authors";
// Mutually recursive by design; the reference is only dereferenced inside the
// `target: () =>` thunk below, so module init order never matters.
// fallow-ignore-next-line circular-dependency
import tagsCollection from "./tags";
import type { PostgresCollectionConfig } from "@rebasepro/types";
import { relatedRecords } from "../display";

const postsCollection: PostgresCollectionConfig = {
    name: "Blog posts",
    singularName: "Blog post",
    slug: "posts",
    table: "posts",
    history: true,
    // Dogfooding the opt-in search block. `content` is the interesting field:
    // the list shows a title and an excerpt, so a term that appears only in the
    // body makes a row look arbitrary — exactly the case `_matches` explains.
    search: {
        language: "english",
        fields: [
            { path: "title", weight: "A" },
            { path: "excerpt", weight: "C" },
            { path: "content", weight: "D" }
        ]
    },
    // Dogfooding the index block, on the three queries this collection
    // actually serves. Each `reason` is what `rebase doctor` will print beside
    // "0 scans in 34 days" — the one moment anyone can decide to delete one.
    indexes: [
        // The admin list: filter by status, newest first. One index serves both
        // the filter and the sort, because a btree can be read in order.
        { on: ["status", { prop: "publish_date", direction: "desc" }],
          reason: "admin list: filter by status, newest first" },
        // The public feed only ever reads published rows, so the index only
        // holds published rows — smaller, and it stays small as drafts pile up.
        { on: ["publish_date"],
          where: { prop: "status", op: "=", value: "published" },
          reason: "public feed: published posts by date" },
        // Postgres does NOT index a foreign key column for you. Without this,
        // listing one author's posts is a sequential scan, and so is the
        // cascade when an author is deleted. `author` resolves to `author_id`.
        { on: ["author"], reason: "an author's posts, and the ON DELETE cascade" }
    ],
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
            relation: {
                kind: "belongsTo",
                target: () => authorsCollection,
            }
        },
        tags: {
            name: "Tags",
            type: "relation",
            relation: {
                kind: "manyToMany",
                target: () => tagsCollection,
            }
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
        // `publish_date` rather than the derived `updated_at`: a post card is
        // read to see when the post goes out, not when someone last touched the
        // row. The date slot formats relatively and reads the sign, so a
        // scheduled post says "in 3d" instead of "just now".
        //
        // The tags are the post's actual tags — a many-to-many that arrives
        // expanded on the same read as the row, so mapping it to names costs no
        // extra request.
        display: {
            title: "title",
            subtitle: "excerpt",
            image: "hero_image",
            status: "status",
            date: "publish_date",
            tags: ({ entity }) => relatedRecords(entity.values.tags)
                .map(tag => String(tag.name ?? ""))
                .filter(Boolean)
        },
        // Everything about *publishing* the post to the rail; the column is then
        // the post itself, ending in the body it exists for.
        form: {
            sidebar: ["status", "publish_date", "author", "tags"],
            sections: [
                { key: "post", properties: ["title", "slug", "hero_image", "excerpt"] },
                { key: "body", title: "Content", properties: ["content"] }
            ]
        },
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
