// Mutually recursive by design: an author has posts, a post has an author. The
// reference is only dereferenced inside the `target: () =>` thunk below, which is
// the framework contract for exactly this, so module init order never matters.
// fallow-ignore-next-line circular-dependency
import postsCollection from "./posts";
import { defineCollection } from "@rebasepro/cms-types";
import type { PostgresCollectionConfig } from "@rebasepro/types";
import { joinParts } from "../display";

const authorsCollection = defineCollection({
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
            admin: { markdown: true },
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
            kind: "hasMany",
            relationName: "posts",
            target: (): PostgresCollectionConfig => postsCollection,
            }
    ],
    admin: {
        icon: "User",
        group: "Content",
        // An author is the target of every post's `author` relation, so this
        // block is what labels the chip on 200 post rows, not just this
        // collection's own cards.
        display: {
            title: "name",
            subtitle: ({ entity }) => joinParts(entity.values.email, entity.values.twitter),
            image: "picture"
        },
        form: {
            sections: [
                { key: "author", properties: ["picture", "name", "email", "bio"] },
                {
                    key: "links",
                    title: "Links",
                    properties: ["twitter", "github", "website"]
                }
            ]
        },
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
        // By name. Sorting a list of people by their email address orders them
        // by whatever their address happens to start with, which is neither the
        // order they are listed under nor one a reader can scan.
        sort: ["name", "asc"]
    }
});


export default authorsCollection;
