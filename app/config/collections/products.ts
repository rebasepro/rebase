import ordersCollection from "./orders";
import productLocalesCollection from "./product_locales";
import { LOCALE_ENUM } from "../locales";
import type { PostgresCollectionConfig } from "@rebasepro/types";
import { joinParts, money } from "../display";

const productsCollection: PostgresCollectionConfig = {
    name: "Products",
    singularName: "Product",
    slug: "products",
    table: "products",
    history: true,
    properties: {
        id: {
            name: "ID",
            type: "string",
            isId: "uuid"
        },
        name: {
            name: "Product Name",
            type: "string",
            validation: {
                required: true
            }
        },
        sku: {
            name: "SKU",
            type: "string",
            validation: {
                required: true,
                unique: true
            },
            description: "Stock Keeping Unit — unique product identifier"
        },
        description: {
            name: "Description",
            type: "string",
            admin: { markdown: true },
            description: "Detailed product description in Markdown"
        },
        images: {
            name: "Product Images",
            type: "array",
            of: {
                name: "Image",
                type: "string",
                storage: {
                    storagePath: "product_images/"
                }
            }
        },
        available_locales: {
            name: "Available Locales",
            type: "array",
            of: {
                name: "Locale",
                type: "string",
                enum: LOCALE_ENUM
            }
        },
        brand: {
            name: "Brand",
            type: "string",
            description: "Product brand or manufacturer"
        },
        category: {
            name: "Category",
            type: "string",
            validation: {
                required: true
            },
            enum: [
                {
                    id: "electronics",
                    label: "Electronics",
                    color: "blue"
                },
                {
                    id: "clothing",
                    label: "Clothing",
                    color: "pink"
                },
                {
                    id: "home_garden",
                    label: "Home & Garden",
                    color: "green"
                },
                {
                    id: "sports",
                    label: "Sports & Outdoors",
                    color: "orange"
                },
                {
                    id: "books",
                    label: "Books & Media",
                    color: "purple"
                },
                {
                    id: "food_beverage",
                    label: "Food & Beverage",
                    color: "yellow"
                },
                {
                    id: "health_beauty",
                    label: "Health & Beauty",
                    color: "red"
                },
                {
                    id: "toys",
                    label: "Toys & Games",
                    color: "cyan"
                }
            ]
        },
        price: {
            name: "Price",
            type: "number",
            validation: {
                required: true,
                min: 0
            },
            description: "Current selling price"
        },
        compare_at_price: {
            name: "Compare-at Price",
            type: "number",
            description: "Original price before discount (shown as strikethrough)"
        },
        cost: {
            name: "Cost per Item",
            type: "number",
            description: "Internal cost for profit margin calculation"
        },
        stock_quantity: {
            name: "Stock Quantity",
            type: "number",
            validation: {
                required: true,
                min: 0
            },
            description: "Available inventory count"
        },
        low_stock_threshold: {
            name: "Low Stock Alert",
            type: "number",
            defaultValue: 10,
            description: "Alert when stock falls below this number"
        },
        weight_grams: {
            name: "Weight (g)",
            type: "number",
            description: "Product weight in grams for shipping"
        },
        rating: {
            name: "Rating",
            type: "number",
            description: "Average customer rating (1-5)"
        },
        review_count: {
            name: "Reviews",
            type: "number",
            description: "Total number of customer reviews"
        },
        status: {
            name: "Status",
            type: "string",
            validation: {
                required: true
            },
            defaultValue: "draft",
            enum: [
                {
                    id: "draft",
                    label: "Draft",
                    color: "gray"
                },
                {
                    id: "active",
                    label: "Active",
                    color: "green"
                },
                {
                    id: "archived",
                    label: "Archived",
                    color: "red"
                }
            ]
        },
        is_featured: {
            name: "Featured",
            type: "boolean",
            description: "Show this product in featured sections"
        },
        created_at: {
            name: "Created at",
            type: "date",
            autoValue: "on_create",
            admin: {
                readOnly: true,
                hideFromCollection: true
            }
        },
        updated_at: {
            name: "Updated at",
            type: "date",
            autoValue: "on_update",
            admin: {
                readOnly: true,
                hideFromCollection: true
            }
        }
    },
    // Headless relation: shows related orders (through order_items) as a subcollection tab
    relations: [
        {
            kind: "via",
            relationName: "orders",
            target: () => ordersCollection,
            cardinality: "many",
            joinPath: [
                {
                    table: "order_items",
                    on: {
                        from: "id", // products.id
                        to: "product_id" // order_items.product_id
                    }
                },
                {
                    table: "orders",
                    on: {
                        from: "order_id", // order_items.order_id
                        to: "id" // orders.id
                    }
                }
            ]
        },
        {
            kind: "hasMany",
            relationName: "product_locales",
            target: () => productLocalesCollection,
            overrides: {
                admin: { hideFromNavigation: false }
            }
        }
    ],
    admin: {
        icon: "Package",
        group: "E-Commerce",
        defaultViewMode: "cards",
        enabledViews: ["table", "cards", "gallery"],
        customViews: ["gallery"],
        // The card grid is this collection's default view, so what a card says
        // is what the collection says. `image` names the array and the renderer
        // takes the first frame; `status` and `category` are named so they keep
        // their enum colours rather than arriving as bare strings.
        display: {
            title: "name",
            subtitle: ({ entity }) => joinParts(
                entity.values.brand,
                money(entity.values.price),
                entity.values.stock_quantity === 0
                    ? "Out of stock"
                    : `${entity.values.stock_quantity} in stock`
            ),
            image: "images",
            status: "status",
            date: "updated_at",
            tags: "category"
        },
        // Everything here is optional — without it the form still derives a
        // two-column layout from the property types. This is what taking hold
        // of that looks like when the derived grouping is not the one you want.
        form: {
            sidebar: ["status", "category", "is_featured"],
            sections: [
                { key: "basics", properties: ["name", "sku", "brand", "images"] },
                {
                    key: "pricing",
                    title: "Pricing & inventory",
                    properties: ["price", "compare_at_price", "cost", "stock_quantity", "low_stock_threshold"]
                },
                {
                    key: "shipping",
                    title: "Shipping & ratings",
                    properties: ["weight_grams", "rating", "review_count"],
                    collapsed: true
                },
                {
                    key: "content",
                    title: "Content",
                    properties: ["description", "available_locales"]
                }
            ]
        },
        propertiesOrder: [
            "name",
            "sku",
            "images",
            "brand",
            "status",
            "category",
            "price",
            "compare_at_price",
            "cost",
            "rating",
            "review_count",
            "stock_quantity",
            "low_stock_threshold",
            "weight_grams",
            "is_featured",
            "description",
            "available_locales",
            "created_at",
            "updated_at"
        ],
        filterPresets: [
            {
                label: "Active products",
                filterValues: {
                    status: ["==", "active"]
                }
            },
            {
                label: "Low stock (< 10)",
                filterValues: {
                    stock_quantity: ["<", 10],
                    status: ["==", "active"]
                },
                sort: ["stock_quantity", "asc"]
            },
            {
                label: "Featured items",
                filterValues: {
                    is_featured: ["==", true]
                }
            },
            {
                label: "Top rated (4+)",
                filterValues: {
                    rating: [">=", 4]
                },
                sort: ["rating", "desc"]
            }
        ]
    }
};


export default productsCollection;
