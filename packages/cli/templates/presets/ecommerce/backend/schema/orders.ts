import { defineTable, col } from "@rebasepro/server/schema";

export const orders = defineTable("orders", {
    columns: {
        id: col.integer().primaryKey().identity(),
        customerEmail: col.text().notNull(),
        status: col.enum(["pending", "processing", "shipped", "delivered", "cancelled"]),
        total: col.numeric().notNull(),
        notes: col.text(),
        createdAt: col.timestamptz().onCreateNow()
    },
    rls: "inherit"
});
