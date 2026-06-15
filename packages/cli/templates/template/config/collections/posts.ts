import { EntityCollection } from "@rebasepro/types";
import authorsCollection from "./authors.js";
import tagsCollection from "./tags.js";

const postsCollection: EntityCollection = {
    name: "Posts",
    singularName: "Post",
    slug: "posts",
    table: "posts",
    icon: "Article",
    properties: {
        id: {
            name: "ID",
            type: "number",
            validation: {
                required: true
            }
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
            markdown: true
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
            relationName: "author",
            target: () => authorsCollection,
            cardinality: "one",
            direction: "owning"
        },
        tags: {
            name: "Tags",
            type: "relation",
            relationName: "tags",
            target: () => tagsCollection,
            cardinality: "many",
            direction: "owning"
        }
    }
};

export default postsCollection;
