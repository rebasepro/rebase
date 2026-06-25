import { buildCollection } from "@rebasepro/common";

/**
 * Users collection – mirrors the Rebase demo `users` Firestore collection.
 *
 * Schema includes:
 * - Basic profile fields (first_name, last_name, email, phone)
 * - Cross-collection references (related_users → users, liked_products → products)
 * - Nested map for profile picture URLs (large + thumbnail)
 */
export const usersCollection = buildCollection({
    driver: "firestore",
    slug: "users",
    name: "Users",
    singularName: "User",
    group: "E-commerce",
    icon: "Users",
    description: "Registered users",
    properties: {
        first_name: {
            name: "First name",
            type: "string"
        },
        last_name: {
            name: "Last name",
            type: "string"
        },
        email: {
            name: "Email",
            type: "string",
            email: true
        },
        phone: {
            name: "Phone",
            type: "string"
        },
        related_users: {
            type: "array",
            name: "Related users",
            of: {
                type: "reference",
                name: "User",
                path: "users"
            }
        },
        liked_products: {
            type: "array",
            name: "Liked products",
            description: "Products this user has liked",
            of: {
                type: "reference",
                name: "Product",
                path: "products"
            }
        },
        picture: {
            name: "Picture",
            type: "map",
            properties: {
                large: {
                    name: "Large",
                    type: "string",
                    url: "image"
                },
                thumbnail: {
                    name: "Thumbnail",
                    type: "string",
                    url: "image"
                }
            }
        }
    }
});
