// Mutually recursive by design; the reference is only dereferenced inside the
// `target: () =>` thunk below, so module init order never matters.
// fallow-ignore-next-line circular-dependency
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { orders } from "./orders.js";
export const customers = defineTable("customers", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        first_name: col.text().notNull(),
        last_name: col.text().notNull(),
        email: col.text().notNull().unique(),
        phone: col.text(),
        avatar: col.storage({ path: "customer_avatars/" }).describe("Customer profile picture"),
        company: col.text(),
        is_vip: col.boolean().describe("Whether this customer has VIP status (spent >= $1000)"),
        lifetime_value: col.numeric().describe("Total amount spent across all orders"),
        total_orders: col.numeric().describe("Number of orders placed"),
        shipping_address: col.text(),
        billing_address: col.text(),
        notes: col.text().describe("Internal notes about this customer"),
        created_at: col.timestamp({ withTimezone: true }).onCreateNow(),
        updated_at: col.timestamp({ withTimezone: true }).onUpdateNow()
    },
    relations: {
        orders: rel.hasMany(() => orders)
    },
    rls: "inherit",
    history: true
});
