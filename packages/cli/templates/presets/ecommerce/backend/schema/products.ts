import { defineTable, col, rel } from "@rebasepro/server/schema";
import { categories } from "./categories";

export const products = defineTable("products", {
    columns: {
        id: col.integer().primaryKey().generatedByDefaultAsIdentity(),
        name: col.text().notNull(),
        description: col.text(),
        price: col.numeric().notNull(),
        image: col.storage({ path: "product_images/" }),
        status: col.enum(["draft", "active", "archived"]),
        categoryId: col.integer()
    },
    relations: {
        category: rel.belongsTo(() => categories)
    },
    rls: "inherit"
});
