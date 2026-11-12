import type { DefaultRls } from "@rebasepro/server/schema";

/**
 * Every Postgres table this backend serves. The Firestore collection is not
 * here: Firestore is read and written by the browser, straight from Firebase,
 * so the backend never sees it (frontend/src/cms/events.ts).
 */
export { customers } from "./customers";
export { orders } from "./orders";

/** What a table with `rls: "inherit"` gets: signed-in staff read, admins write. */
export const defaultRls: DefaultRls = [
    { operation: "select", access: "authenticated" },
    { operations: ["insert", "update", "delete"], roles: ["admin"] }
];
