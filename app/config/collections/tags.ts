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
            // TODO(relations): ambiguous under the tagged union — declare the kind explicitly.
            // Was: cardinality=many direction=inverse
            kind: "AMBIGUOUS",
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
