import { customizeTable, updateRecord } from "@rebasepro/cms";
import type { products } from "../../../backend/schema/products";
import { joinParts, money } from "./lib/display";
import { LOCALE_LABELS } from "./lib/locales";

export const productsCms = customizeTable<typeof products>("products", {
    icon: "Package",
    group: "E-Commerce",
    entityActions: [
        {
            key: "publish",
            name: "Publish",
            icon: "Rocket",
            collapsed: false,
            isEnabled: ({ row }) => row?.status !== "active",
            disabledReason: () => "Already live in the store",
            onClick: ({ row, id, path, context, collection }) => row &&
                updateRecord(context, collection?.slug ?? path, id, { status: "active" }, "Product published")
        },
        {
            key: "restock",
            name: "Restock 50 units",
            icon: "PackagePlus",
            collapsed: false,
            isEnabled: ({ row }) => row?.status !== "archived",
            disabledReason: () => "Archived products can't be restocked",
            onClick: ({ row, id, path, context, collection }) => row &&
                updateRecord(context, collection?.slug ?? path, id,
                    { stock_quantity: Number(row.stock_quantity ?? 0) + 50 },
                    "Added 50 units to stock")
        },
        {
            key: "feature",
            name: "Feature on the homepage",
            icon: "Star",
            isEnabled: ({ row }) => !row?.is_featured && row?.status === "active",
            disabledReason: ({ row }) => row?.is_featured
                ? "Already featured"
                : "Only live products can be featured",
            onClick: ({ row, id, path, context, collection }) => row &&
                updateRecord(context, collection?.slug ?? path, id, { is_featured: true }, "Featured on the homepage")
        },
        {
            key: "archive",
            name: "Archive",
            icon: "Archive",
            isEnabled: ({ row }) => row?.status !== "archived",
            disabledReason: () => "Already archived",
            onClick: ({ row, id, path, context, collection }) => row &&
                updateRecord(context, collection?.slug ?? path, id, { status: "archived", is_featured: false }, "Product archived")
        }
    ],
    defaultViewMode: "cards",
    customViews: ["price-map"],
    kanban: {
        columnField: "status",
        orderField: "__order"
    },
    display: {
        title: "name",
        subtitle: ({ row }) => joinParts(
            row.brand,
            money(row.price),
            row.stock_quantity === 0
                ? "Out of stock"
                : `${row.stock_quantity} in stock`
        ),
        image: "images",
        status: "status",
        date: "updated_at",
        tags: "category"
    },
    form: {
        sidebar: ["status", "category", "is_featured"],
        sections: [
            {
                key: "basics",
                fields: ["name", "sku", "brand", "images"]
            },
            {
                key: "pricing",
                title: "Pricing & inventory",
                fields: ["price", "compare_at_price", "cost", "stock_quantity", "low_stock_threshold"]
            },
            {
                key: "shipping",
                title: "Shipping & ratings",
                collapsed: true,
                fields: ["weight_grams", "rating", "review_count"]
            },
            {
                key: "content",
                title: "Content",
                fields: ["description", "available_locales"]
            }
        ]
    },
    fieldOrder: [
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
        "updated_at",
        "__order"
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
    ],
    fields: {
        name: {
            name: "Product Name"
        },
        sku: {
            name: "SKU"
        },
        description: {
            markdown: true
        },
        images: {
            name: "Product Images",
            of: {
                name: "Image"
            }
        },
        available_locales: {
            of: {
                name: "Locale",
                enumLabels: LOCALE_LABELS
            }
        },
        category: {
            enumLabels: {
                electronics: {
                    label: "Electronics",
                    color: "blue"
                },
                clothing: {
                    label: "Clothing",
                    color: "pink"
                },
                home_garden: {
                    label: "Home & Garden",
                    color: "green"
                },
                sports: {
                    label: "Sports & Outdoors",
                    color: "orange"
                },
                books: {
                    label: "Books & Media",
                    color: "purple"
                },
                food_beverage: {
                    label: "Food & Beverage",
                    color: "yellow"
                },
                health_beauty: {
                    label: "Health & Beauty",
                    color: "red"
                },
                toys: {
                    label: "Toys & Games",
                    color: "cyan"
                }
            }
        },
        compare_at_price: {
            name: "Compare-at Price"
        },
        cost: {
            name: "Cost per Item"
        },
        low_stock_threshold: {
            name: "Low Stock Alert"
        },
        weight_grams: {
            name: "Weight (g)"
        },
        review_count: {
            name: "Reviews"
        },
        status: {
            enumLabels: {
                draft: {
                    label: "Draft",
                    color: "gray"
                },
                active: {
                    label: "Active",
                    color: "green"
                },
                archived: {
                    label: "Archived",
                    color: "red"
                }
            }
        },
        is_featured: {
            name: "Featured"
        },
        created_at: {
            name: "Created at",
            readOnly: true,
            hidden: true
        },
        updated_at: {
            name: "Updated at",
            readOnly: true,
            hidden: true
        },
        __order: {
            name: "Board position",
            disabled: true,
            hidden: true
        },
        product_locales: {
            overrides: {
                hideFromNavigation: false
            }
        }
    }
});
