import type { AdminCollection } from "@rebasepro/cms-types";

export const usersCollectionTemplate = {
    slug: "users",
    table: "users",
    name: "Users",
    singularName: "User",
    description: "Registered users in the app/web",
    icon: "User",
    properties: {
        displayName: {
            name: "Display name",
            type: "string"
        },
        email: {
            name: "Email",
            type: "string",
            email: true
        },
        emailVerified: {
            name: "Email verified",
            type: "boolean"
        },
        phone: {
            name: "Phone",
            type: "string"
        },
        favourite_products: {
            name: "Favourite products",
            type: "array",
            of: {
                type: "reference",
                path: "products"
            }
        },
        photoURL: {
            name: "Photo URL",
            type: "string",
            // `url` says the data is a URL — it is part of the API contract, and
            // it is a boolean. How the panel renders it is `admin.urlPreview`.
            url: true,
            admin: { urlPreview: "image" }
        }
    }
} satisfies AdminCollection;
