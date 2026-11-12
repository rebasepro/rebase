import { col, defineTable, rel } from "@rebasepro/server/schema";
import { orders } from "./orders";

/**
 * A Postgres table. The backend serves it at `/api/data/customers`, under
 * row-level security, and the admin shows it with no frontend code at all.
 *
 * The Firestore `fs_events` collection (frontend/src/cms/events.ts) points
 * here: an event's `customerId` holds a customer's `id`.
 */
export const customers = defineTable("customers", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        name: col.text().notNull(),
        email: col.text().notNull().unique().validate({ email: true }),
        createdAt: col.timestamptz().onCreateNow()
    },
    relations: {
        orders: rel.hasMany(() => orders)
    },
    rls: "inherit"
});
