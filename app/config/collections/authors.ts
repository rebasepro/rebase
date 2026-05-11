import { EntityCollection } from "@rebasepro/types";
import postsCollection from "./posts";

const authorsCollection: EntityCollection = {
    name: "Authors",
    singularName: "Author",
    slug: "authors",
    table: "authors",
    icon: "User",
    group: "Content",
    history: true,
    properties: {
        id: {
            name: "ID",
            type: "number",
            isId: "increment"
        },
        name: {
            name: "Name",
            type: "string",
            validation: {
                required: true
            },
            callbacks: {
                beforeSave: ({ value }) => {
                    return typeof value === "string" ? value.trim() : value;
                }
            }
        },
        email: {
            name: "Email",
            type: "string",
            validation: {
                required: true
            },
            callbacks: {
                beforeSave: ({ value }) => {
                    return typeof value === "string" ? value.trim() : value;
                }
            }
        },
        picture: {
            name: "Picture",
            type: "string",
            validation: {
                required: false
            },
            storage: {
                storagePath: "author_pictures/"
            }
        },
        bio: {
            name: "Bio",
            type: "string",
            markdown: true,
            description: "Author biography in Markdown format"
        },
        twitter: {
            name: "Twitter / X",
            type: "string",
            description: "Twitter/X handle (e.g. @username)"
        },
        github: {
            name: "GitHub",
            type: "string",
            description: "GitHub username"
        },
        website: {
            name: "Website",
            type: "string",
            description: "Personal website URL"
        },
        userId: {
            name: "Linked User",
            type: "string",
            userSelect: true,
            description: "Link to a Rebase user"
        }
    },
    // Headless relation: no property for "posts", only used for subcollection tab
    relations: [
        {
            relationName: "posts",
            target: () => postsCollection,
            cardinality: "many",
            direction: "inverse",
            inverseRelationName: "author"
        }
    ],
    propertiesOrder: [
        "id",
        "name",
        "email",
        "picture",
        "bio",
        "twitter",
        "github",
        "website",
        "userId"
    ],
    callbacks: {
        beforeSave: ({ values }) => {
            return values;
        },
        afterSave: ({ values }) => {
        }
    },

    filter: undefined,
    sort: [
        "email",
        "asc"
    ]
};

export default authorsCollection;
