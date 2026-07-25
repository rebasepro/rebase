import { defineCollection } from "@rebasepro/common";

/**
 * Product categories enum matching the Rebase demo data.
 */
const categories = {
    art_and_decoration: "Art and decoration",
    art_design_books: "Art and design books",
    babys: "Babies and kids",
    backpacks: "Backpacks and bags",
    bath: "Bath",
    bicycle: "Bicycle",
    books: "Books",
    cameras: "Cameras",
    clothing_man: "Clothing man",
    clothing_woman: "Clothing woman",
    coffee_and_tea: "Coffee and tea",
    cookbooks: "Cookbooks",
    delicatessen: "Delicatessen",
    desk_accessories: "Desk accessories",
    exercise_equipment: "Exercise equipment",
    furniture: "Furniture",
    gardening: "Gardening",
    headphones: "Headphones",
    home_accessories: "Home accessories",
    home_storage: "Home storage",
    kitchen: "Kitchen",
    lighting: "Lighting",
    music: "Music",
    outdoors: "Outdoors",
    personal_care: "Personal care",
    photography_books: "Photography books",
    serveware: "Serveware",
    smart_home: "Smart Home",
    sneakers: "Sneakers",
    speakers: "Speakers",
    sunglasses: "Sunglasses",
    toys_and_games: "Toys and games",
    watches: "Watches"
};

/**
 * Locale subcollection for product translations.
 * Each product can have localized content stored as subcollections.
 */
const localeCollection = defineCollection({
    engine: "firestore",
    slug: "locales",
    name: "Locales",
    singularName: "Locale",
    properties: {
        name: {
            type: "string",
            name: "Name"
        },
        description: {
            type: "string",
            name: "Description",
            admin: { multiline: true }
        }
    }
});

/**
 * Products collection – mirrors the Rebase demo `products` Firestore collection.
 *
 * Schema includes:
 * - Basic product info (name, brand, category, description)
 * - Pricing with conditional validation (disabled when not available)
 * - Firebase Storage image uploads (single + multi)
 * - Self-referencing array of related products
 * - Nested map for publisher info
 * - Locale subcollections for i18n
 */
export const productsCollection = defineCollection({
    engine: "firestore",
    slug: "products",
    name: "Products",
    singularName: "Product",
    description: "List of the products currently sold in our shop",
    subcollections: () => [localeCollection],
    properties: {
        name: {
            type: "string",
            name: "Name",
            description: "Name of this product",
            validation: {
                required: true
            }
        },
        category: {
            type: "string",
            name: "Category",
            enum: categories
        },
        images: {
            type: "array",
            name: "Images",
            of: {
                type: "string",
                name: "Image",
                storage: {
                    storagePath: "images",
                    acceptedFiles: ["image/*"],
                    metadata: {
                        cacheControl: "max-age=1000000"
                    }
                }
            },
            description: "This field allows uploading multiple images at once"
        },
        available: {
            type: "boolean",
            name: "Available",
            description: "Is this product available in the website"
        },
        price: {
            type: "number",
            name: "Price",
            validation: {
                required: true,
                requiredMessage: "You must set a price between 0 and 10000",
                min: 0,
                max: 10000
            },
            dynamicProps: ({ values }: { values: Record<string, unknown> }) => ({
                type: "number" as const,
                disabled: !values.available ? {
                    clearOnDisabled: true,
                    disabledMessage: "You can only set the price on available items"
                } : false
            })
        },
        currency: {
            type: "string",
            name: "Currency",
            enum: [
                { id: "EUR", label: "Euros", color: "blue" },
                { id: "DOL", label: "Dollars", color: "green" }
            ],
            validation: {
                required: true
            }
        },
        public: {
            type: "boolean",
            name: "Public",
            description: "Should this product be visible in the website"
        },
        brand: {
            type: "string",
            name: "Brand",
            validation: {
                required: true
            }
        },
        description: {
            type: "string",
            name: "Description",
            admin: { markdown: true }
        },
        amazon_link: {
            type: "string",
            name: "Amazon link",
            admin: { url: true }
        },
        related_products: {
            type: "array",
            name: "Related products",
            description: "Reference to self",
            of: {
                type: "reference",
                name: "Product",
                path: "products"
            }
        },
        publisher: {
            name: "Publisher",
            description: "This is an example of a map property",
            type: "map",
            properties: {
                name: {
                    name: "Name",
                    type: "string"
                },
                external_id: {
                    name: "External id",
                    type: "string"
                }
            }
        },
        added_on: {
            type: "date",
            name: "Added on",
            autoValue: "on_create"
        },
        tags: {
            type: "array",
            name: "Tags",
            of: {
                type: "string",
                name: "Tag"
            }
        }
    },
    admin: {
        group: "E-commerce",
        icon: "ShoppingCart",
        filterPresets: [
            {
                label: "Available products",
                filterValues: {
                    available: ["==", true]
                }
            },
            {
                label: "Public & available",
                filterValues: {
                    public: ["==", true],
                    available: ["==", true]
                }
            },
            {
                label: "High price (> €100)",
                filterValues: {
                    price: [">", 100]
                },
                sort: ["price", "desc"]
            }
        ]
    }
});
