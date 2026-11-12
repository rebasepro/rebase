import { defineFirestoreCollection } from "@rebasepro/firebase";

/**
 * A Firestore collection, declared in the frontend: its documents live in
 * Firebase at `events/<id>` and are read and written by the browser through
 * the `firestore` data source (App.tsx), under your Firestore security rules.
 *
 * `customerId` points at the Postgres `customers` table. When an operator
 * opens the reference, the lookup is routed to the Rebase backend, and the
 * customer comes back under Postgres row-level security. In the document the
 * reference is stored as the customer's id, a plain string.
 */
export const firestoreEvents = defineFirestoreCollection({
    slug: "fs_events",
    path: "events",
    name: "Live events (Firestore)",
    singularName: "Live event",
    dataSource: "firestore",
    fields: {
        type: {
            name: "Event type",
            type: "string",
            required: true,
            enum: { signup: "Sign-up", checkout: "Checkout", support: "Support request" }
        },
        payload: { name: "Payload", type: "map" },
        customerId: { name: "Customer", type: "reference", target: "customers" },
        receivedAt: { name: "Received at", type: "date", autoValue: "on_create" }
    },
    admin: {
        icon: "Bolt",
        group: "Firestore"
    }
});
