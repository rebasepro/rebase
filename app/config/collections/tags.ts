import { defineCollection } from "@rebasepro/common";
import postsCollection from "./posts";

const tagsCollection = defineCollection({
    name: "Tags",
    singularName: "Tag",
    slug: "tags",
    table: "tags",
    icon: "Tag",
    group: "Content",
    history: true,
    hideFromNavigation: true,
    properties: {
        id: {
            name: "ID",
            type: "string",
            isId: "uuid",
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
});


export default tagsCollection;
