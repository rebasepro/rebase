import postsCollection from "./posts";
import type { PostgresCollectionConfig } from "@rebasepro/types";

const tagsCollection: PostgresCollectionConfig = {
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
            kind: "manyToMany",
            relationName: "posts",
            target: () => postsCollection,
            }
    ],
    admin: {
        icon: "Tag",
        group: "Content",
        hideFromNavigation: true
    }
};


export default tagsCollection;
