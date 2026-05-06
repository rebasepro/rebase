import { EntityCollection } from "@rebasepro/types";
import postsCollection from "./posts.js";

const tagsCollection: EntityCollection = {
    name: "Tags",
    singularName: "Tag",
    slug: "tags",
    table: "tags",
    icon: "Tag",
    group: "Content",
    history: true,
    properties: {
        id: {
            name: "ID",
            type: "number",
            validation: {
                required: true
            }
        },
        name: {
            name: "Tag Name",
            type: "string",
            validation: {
                required: true
            }
        }
    },
    relations: [
        {
            relationName: "posts",
            target: () => postsCollection,
            cardinality: "many",
            direction: "inverse",
            inverseRelationName: "tags"
        }
    ],
    entityViews: [
        "__rebase_history"
    ]
};

export default tagsCollection;
