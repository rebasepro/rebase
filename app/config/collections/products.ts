import { EntityCollection } from "@rebasepro/types";

const productsCollection: EntityCollection = {
    name: "Products",
    singularName: "Product",
    slug: "products",
    table: "products",
    icon: "Inventory",
    group: "E-Commerce",
    history: true,
    openEntityMode: "split",
    defaultViewMode: "cards",
    enabledViews: ["table", "cards"],
    properties: {
        id: {
            name: "ID",
            type: "number",
            isId: "increment"
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
            multiline: true,
            description: "Detailed product description"
        },
        image: {
            name: "Product Image",
            type: "string",
            storage: {
                storagePath: "product_images/"
            }
        },
        category: {
            name: "Category",
            type: "string",
            validation: {
                required: true
            },
            enum: [
                { id: "electronics",
label: "Electronics",
color: "blue" },
                { id: "clothing",
label: "Clothing",
color: "pink" },
                { id: "home_garden",
label: "Home & Garden",
color: "green" },
                { id: "sports",
label: "Sports & Outdoors",
color: "orange" },
                { id: "books",
label: "Books & Media",
color: "purple" },
                { id: "food_beverage",
label: "Food & Beverage",
color: "yellow" },
                { id: "health_beauty",
label: "Health & Beauty",
color: "red" },
                { id: "toys",
label: "Toys & Games",
color: "cyan" }
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
        status: {
            name: "Status",
            type: "string",
            validation: {
                required: true
            },
            defaultValue: "draft",
            enum: [
                { id: "draft",
label: "Draft",
color: "gray" },
                { id: "active",
label: "Active",
color: "green" },
                { id: "archived",
label: "Archived",
color: "red" }
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
            readOnly: true,
            hideFromCollection: true
        },
        updated_at: {
            name: "Updated at",
            type: "date",
            autoValue: "on_update",
            readOnly: true,
            hideFromCollection: true
        }
    },
    propertiesOrder: [
        "name",
        "sku",
        "image",
        "status",
        "category",
        "price",
        "compare_at_price",
        "cost",
        "stock_quantity",
        "low_stock_threshold",
        "weight_grams",
        "is_featured",
        "description",
        "created_at",
        "updated_at"
    ]
};

productsCollection.securityRules = [
    {
        name: "test_policy",
        mode: "permissive",
        operation: "all",
        pgRoles: ["public"],
        using: "true"
    }
];

export default productsCollection;
