import { defineCollection } from "@rebasepro/cms-types";
import authorsCollection from "./authors.js";
import tagsCollection from "./tags.js";

const postsCollection = defineCollection({
    name: "Posts",
    singularName: "Post",
    slug: "posts",
    table: "posts",
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
