import { defineTable, col, rel } from "@rebasepro/server/schema";
import { LOCALES } from "../lib/locales";
import { orders } from "./orders";
import { productLocales } from "./product_locales";

export const products = defineTable("products", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        name: col.text().notNull(),
        sku: col.text().notNull().unique().describe("Stock Keeping Unit — unique product identifier"),
        description: col.text().describe("Detailed product description in Markdown"),
        images: col.storage({ path: "product_images/" }).multiple(),
        available_locales: col.text({ enum: LOCALES }).array(),
        brand: col.text().describe("Product brand or manufacturer"),
        category: col.enum([
            "electronics",
            "clothing",
            "home_garden",
            "sports",
            "books",
            "food_beverage",
            "health_beauty",
            "toys"
        ]).notNull(),
        price: col.numeric().notNull().validate({ min: 0 }).describe("Current selling price"),
        compare_at_price: col.numeric().describe("Original price before discount (shown as strikethrough)"),
        cost: col.numeric().describe("Internal cost for profit margin calculation"),
        stock_quantity: col.numeric().notNull().validate({ min: 0 }).describe("Available inventory count"),
        low_stock_threshold: col.numeric().default(10).describe("Alert when stock falls below this number"),
        weight_grams: col.numeric().describe("Product weight in grams for shipping"),
        rating: col.numeric().describe("Average customer rating (1-5)"),
        review_count: col.numeric().describe("Total number of customer reviews"),
        status: col.enum(["draft", "active", "archived"]).notNull().default("draft"),
        is_featured: col.boolean().describe("Show this product in featured sections"),
        created_at: col.timestamp({ withTimezone: true }).onCreateNow(),
        updated_at: col.timestamp({ withTimezone: true }).onUpdateNow(),
        __order: col.text().describe("Fractional index maintained by the Kanban board")
    },
    relations: {
        orders: rel.via(() => orders, {
            steps: [
                { table: "order_items", on: { from: "id", to: "product_id" } },
                { table: "orders", on: { from: "order_id", to: "id" } }
            ],
            cardinality: "many"
        }),
        product_locales: rel.hasMany(() => productLocales)
    },
    rls: "inherit",
    history: true
});
