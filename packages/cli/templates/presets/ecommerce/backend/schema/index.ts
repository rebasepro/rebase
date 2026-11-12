import type { DefaultRls } from "@rebasepro/server/schema";

/**
 * Every table this backend serves. A `defineTable` that is not exported from
 * here is refused at boot and by `rebase db generate`.
 */
export { products } from "./products";
export { categories } from "./categories";
export { orders } from "./orders";
export { users } from "./users";

/**
 * What a table with `rls: "inherit"` gets: admins read and write, nobody else.
 *
 * Said out loud rather than left to `"admin-only"`, so `rebase verify` (and the
 * reader) can tell a decision from an omission. A storefront opens tables up one
 * at a time: `{ operation: "select", access: "public" }` on products and
 * categories for a public catalogue, and `ownerField` on orders once they carry
 * the customer's user id.
 */
export const defaultRls: DefaultRls = [
    { operation: "all", roles: ["admin"] }
];
