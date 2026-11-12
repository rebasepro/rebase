import { col, defineTable, rel } from "@rebasepro/server/schema";
import { customers } from "./customers";

/**
 * A Postgres table that points at a Firestore document.
 *
 * `sourceEventId` is plain text to Postgres: the id of the `fs_events`
 * document the order came from. The backend knows nothing about Firestore —
 * the admin draws the column as a reference to that collection because
 * frontend/src/cms/orders.tsx says so (`referenceTo: "fs_events"`).
 */
export const orders = defineTable("orders", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        customerId: col.uuid().notNull(),
        total: col.numeric(10, 2).notNull(),
        status: col.enum(["pending", "paid", "shipped", "cancelled"]).notNull().default("pending"),
        sourceEventId: col.text(),
        createdAt: col.timestamptz().onCreateNow()
    },
    relations: {
        // Binds to `customerId` (SQL `customer_id`), the column declared above.
        customer: rel.belongsTo(() => customers, { onDelete: "cascade" })
    },
    // Signed-in staff read orders; only admins change them.
    rls: [
        { operation: "select", access: "authenticated" },
        { operations: ["insert", "update", "delete"], roles: ["admin"] }
    ]
});
