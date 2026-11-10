import { defineCollection } from "@rebasepro/cms-types";
import authorsCollection from "./authors";
import tagsCollection from "./tags";

const postsCollection = defineCollection({
    name: "Posts",
    singularName: "Post",
    slug: "posts",
    table: "posts",
    // A post is readable once it is published, not before. Without rules of its
    // own it would take `defaultSecurityRules` from index.ts, and every reader
    // would see drafts — anonymous ones too, once AUTH_REQUIRE=false serves a
    // public site from this backend.
    securityRules: [
        {
            operation: "select",
            using: "{status} = 'published'"
        },
        {
            // Editors read drafts and posts in review; admins already read everything.
            operation: "select",
            roles: ["editor"]
        },
        {
            operations: ["insert", "update", "delete"],
            roles: ["admin"]
        }
    ],
    properties: {
        id: {
            name: "ID",
            type: "number",
            isId: "increment"
        },
        title: {
            name: "Title",
            type: "string",
            validation: {
                required: true
            }
        },
        content: {
            name: "Content",
            type: "string",
            admin: {
                markdown: true
            }
        },
        status: {
            name: "Status",
            type: "string",
            enum: [
                {
                    id: "draft",
                    label: "Draft",
                    color: "gray"
                },
                {
                    id: "review",
                    label: "In Review",
                    color: "orange"
                },
                {
                    id: "published",
                    label: "Published",
                    color: "green"
                }
            ]
        },
        author: {
            name: "Author",
            type: "relation",
            relation: {
                kind: "belongsTo",
                target: () => authorsCollection,
                relationName: "author",
            }
        },
        tags: {
            name: "Tags",
            type: "relation",
            relation: {
                kind: "manyToMany",
                target: () => tagsCollection,
                relationName: "tags",
            }
        }
    },
    admin: {
        icon: "Article"
    }
});

export default postsCollection;
