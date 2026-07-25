import { defineCollection } from "@rebasepro/common";

// This is a demo collection with many of the available properties
export const demoCollection = defineCollection({
    engine: "firestore",
    slug: "demo",
    name: "Demo collection",
    description: "This is a demo collection with many of the **available properties**",
    properties: {

        // string property with validation
        name: {
            type: "string",
            name: "Name",
            validation: {
                required: true
            }
        },

        // simple boolean
        available: {
            type: "boolean",
            name: "Available"
        },

        // you can define this property dynamically, and modify it based on the values of other properties
        price: {
            type: "number",
            name: "Price",
            description: "Price with range validation",
            dynamicProps: ({ values }: { values: Record<string, unknown> }) => ({
                type: "number" as const,
                validation: {
                    requiredMessage: "You must set a price between 0 and 1000",
                    min: 0,
                    max: 1000
                },
                disabled: !values.available ? {
                    clearOnDisabled: true,
                    disabledMessage: "You can only set the price on available items"
                } : false
            })
        },

        // multiline
        description: {
            type: "string",
            name: "Description",
            admin: { multiline: true },
        },

        // markdown
        text: {
            type: "string",
            name: "Blog text",
            admin: { markdown: true },
        },

        // array of strings
        ingredients: {
            name: "Ingredients",
            type: "array",
            of: {
                type: "string",
                name: "Ingredient"
            }
        },

        // url
        amazon_link: {
            type: "string",
            name: "Amazon link",
            admin: { url: true },
            validation: {
                required: true,
                requiredMessage: "The amazon link is required",
            }
        },

        // email
        user_email: {
            type: "string",
            name: "User email",
            email: true
        },

        // single selection
        category: {
            type: "string",
            name: "Category",
            enum: {
                art_design_books: "Art and design books",
                backpacks: "Backpacks and bags",
                bath: "Bath",
                bicycle: "Bicycle",
                books: "Books"
            }
        },

        // multiple selection
        locale: {
            name: "Available locales",
            type: "array",
            of: {
                type: "string",
                name: "Locale",
                enum: {
                    es: "Spanish",
                    en: "English",
                    fr: {
                        id: "fr",
                        label: "French",
                        disabled: true
                    }
                }
            },
            defaultValue: [
                "es"
            ]
        },

        // date
        expiry: {
            type: "date",
            name: "Expiry date",
            mode: "date"
        },

        // date and time
        arrival_time: {
            type: "date",
            name: "Arrival time",
            mode: "date_time"
        },

        // auto update on create
        created_at: {
            type: "date",
            name: "Created at",
            autoValue: "on_create"
        },

        // auto update on update
        updated_on: {
            type: "date",
            name: "Updated at",
            autoValue: "on_update"
        },

        // storing a single image
        main_image: {
            type: "string",
            name: "Main image",
            storage: {
                storagePath: "images",
                acceptedFiles: [
                    "image/*"
                ],
                maxSize: 1000000,
                metadata: {
                    cacheControl: "max-age=1000000"
                }
            }
        },

        // storing multiple images
        images: {
            type: "array",
            name: "Images",
            of: {
                type: "string",
                name: "Image",
                storage: {
                    storagePath: "images",
                    acceptedFiles: [
                        "image/*"
                    ],
                    metadata: {
                        cacheControl: "max-age=1000000"
                    }
                }
            },
            description: "This fields allows uploading multiple images at once"
        },

        // group of properties
        address: {
            name: "Address",
            type: "map",
            properties: {
                street: {
                    name: "Street",
                    type: "string"
                },
                postal_code: {
                    name: "Postal code",
                    type: "number"
                }
            },
            expanded: true
        },

        // block of content with dynamic properties
        content: {
            name: "Content",
            type: "array",
            oneOf: {
                typeField: "type",
                valueField: "value",
                properties: {
                    images: {
                        type: "string",
                        name: "Image",
                        storage: {
                            storagePath: "images",
                            acceptedFiles: [
                                "image/*"
                            ]
                        }
                    },
                    text: {
                        type: "string",
                        name: "Text",
                        admin: { markdown: true }
                    },
                    products: {
                        name: "Products",
                        type: "array",
                        of: {
                            type: "reference",
                            name: "Product",
                            path: "products"
                        }
                    }
                }
            }
        },
    }
});
