import { customizeTable } from "@rebasepro/cms";
import type { orders } from "../../../backend/schema/orders";

/**
 * How the admin shows the Postgres `orders` table. Presentation only: the
 * columns, their types and who may read or write them are the table's, in
 * backend/schema/orders.ts. `customers` has no file like this one, and is
 * shown with the defaults.
 */
export const ordersCms = customizeTable<typeof orders>("orders", {
    singularName: "Order",
    icon: "ShoppingCart",
    group: "Postgres",
    fields: {
        status: {
            enumLabels: {
                pending: { label: "Pending", color: "gray" },
                paid: { label: "Paid", color: "blue" },
                shipped: { label: "Shipped", color: "green" },
                cancelled: { label: "Cancelled", color: "red" }
            }
        },
        // A text column holding a Firestore document id, drawn and picked as
        // a reference to the `fs_events` collection — the preview is read
        // from Firestore, not from the backend.
        sourceEventId: { name: "Source event", referenceTo: "fs_events" }
    }
});
