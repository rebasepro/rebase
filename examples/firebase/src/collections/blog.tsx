import { buildCollection } from "@rebasepro/common";

/**
 * Blog collection – mirrors the Rebase demo `blog` Firestore collection.
 *
 * Schema includes:
 * - Header image via Firebase Storage
 * - Polymorphic content blocks (text/markdown, quotes, images, product refs)
 *   using the `oneOf` discriminated union pattern
 * - Status enum with draft/published workflow
 * - Publish date and review flag
 * - Tags array
 * - Initial filter showing only published entries by default
 */
export const blogCollection = buildCollection({
    driver: "firestore",
    slug: "blog",
    name: "Blog",
    singularName: "Blog entry",
    icon: "FileText",
    group: "Content",
    description: "A collection of blog entries",
    defaultSize: "l",
    filter: {
        status: ["==", "published"]
    },
    properties: {
        name: {
            name: "Name",
            validation: { required: true },
            type: "string"
        },
        header_image: {
            name: "Header image",
            type: "string",
            storage: {
                storagePath: "images",
                acceptedFiles: ["image/*"],
                metadata: {
                    cacheControl: "max-age=1000000"
                }
            }
        },
        content: {
            name: "Content",
            description: "Content blocks for the blog entry",
            validation: { required: true },
            type: "array",
            oneOf: {
                typeField: "type",
                valueField: "value",
                properties: {
                    text: {
                        type: "string",
                        name: "Text",
                        markdown: true
                    },
                    quote: {
                        type: "string",
                        name: "Quote",
                        multiline: true
                    },
                    images: {
                        name: "Images",
                        type: "array",
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
                        description: "Upload multiple images and reorder them"
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
        created_on: {
            name: "Created on",
            type: "date",
            autoValue: "on_create"
        },
        status: {
            name: "Status",
            validation: { required: true },
            type: "string",
            enum: {
                published: "Published",
                draft: "Draft"
            },
            defaultValue: "draft"
        },
        publish_date: {
            name: "Publish date",
            type: "date"
        },
        reviewed: {
            name: "Reviewed",
            type: "boolean"
        },
        tags: {
            name: "Tags",
            description: "Example of generic array",
            type: "array",
            of: {
                type: "string",
                name: "Tag"
            }
        }
    }
});
