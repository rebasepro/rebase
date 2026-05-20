import { EntityCollection } from "@rebasepro/types";
import authorsCollection from "./authors";
import tagsCollection from "./tags";

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
            multiline: true
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
            relation: {
                relationName: "author",
                cardinality: "one",
                direction: "owning",
                target: () => authorsCollection
            }
        },
        tags: {
            name: "Tags",
            type: "relation",
            relationName: "tags",
            relation: {
                relationName: "tags",
                cardinality: "many",
                direction: "owning",
                target: () => tagsCollection
            }
        }
    }
};

export default postsCollection;
