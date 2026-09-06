import postsCollection from "./posts";
import { defineCollection } from "@rebasepro/cms-types";
import type { PostgresCollectionConfig } from "@rebasepro/types";

const tagsCollection = defineCollection({
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
            target: (): PostgresCollectionConfig => postsCollection,
            }
    ],
    admin: {
        icon: "Tag",
        group: "Content",
        // A tag is only ever reached through a post, so it is not a drawer
        // destination — but it is also not worth a tab on the post it labels,
        // which is the half `hideFromEntityViews` says separately.
        hideFromNavigation: true,
        hideFromEntityViews: true,
        display: { title: "name" }
    }
});


export default tagsCollection;
