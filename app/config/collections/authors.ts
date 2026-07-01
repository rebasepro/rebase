import { defineCollection } from "@rebasepro/common";
import postsCollection from "./posts";
import { maskEmail, maskName, maskHandle, maskValues } from "../masking";

const authorsCollection = defineCollection({
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
    ],
    // Redact PII at the driver level (runs on REST, realtime, and `rebase.data`).
    callbacks: {
        afterRead: ({ entity }) => ({
            ...entity,
            values: maskValues(entity.values, {
                email: maskEmail,
                name: maskName,
                twitter: maskHandle,
                github: maskHandle,
                website: () => "https://***",
                picture: null
            })
        })
    }
});


authorsCollection.securityRules = [
    {
        name: "authors_public_access",
        mode: "permissive",
        operation: "all",
        pgRoles: ["public"],
        using: "true"
    }
];

export default authorsCollection;
