import postsCollection from "./posts";
import type { AdminCollectionConfig } from "@rebasepro/admin-types";

const tagsCollection: AdminCollectionConfig = {
    name: "Tags",
    singularName: "Tag",
    slug: "tags",
    table: "tags",
    history: true,
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
    admin: {
        icon: "Tag",
        group: "Content",
        hideFromNavigation: true
    }
};


export default tagsCollection;
