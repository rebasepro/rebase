// Mutually recursive by design: an author has posts, a post has an author. The
// reference is only dereferenced inside the `target: () =>` thunk below, which is
// the framework contract for exactly this, so module init order never matters.
// fallow-ignore-next-line circular-dependency
import postsCollection from "./posts";
import type { AdminCollectionConfig } from "@rebasepro/admin-types";

const authorsCollection: AdminCollectionConfig = {
    name: "Authors",
    singularName: "Author",
    slug: "authors",
    table: "authors",
    history: true,
    properties: {
        id: {
            name: "ID",
            type: "string",
            isId: "uuid"
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
            ui: { markdown: true },
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
    admin: {
        icon: "User",
        group: "Content",
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
        defaultFilter: undefined,
        sort: [
            "email",
            "asc"
        ]
    }
};


export default authorsCollection;
