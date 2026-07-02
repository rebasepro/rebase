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
    securityRules: [
        {
            name: "tags_public_access",
            mode: "permissive",
            operation: "all",
            pgRoles: ["authenticated"],
            using: "true"
        }
    ]
});


export default tagsCollection;
