import productsCollection from "./products";
import categoriesCollection from "./categories";
import ordersCollection from "./orders";
// Resolves after `rebase init` copies this file into config/collections/,
// next to the shared users.ts — not from inside presets/, which never runs.
import usersCollection from "./users";
import type { SecurityRule } from "@rebasepro/types";

/**
 * Applied to any collection in this directory that declares no
 * `securityRules` of its own: admins read and write, nobody else.
 *
 * Said out loud rather than left to the framework's admin-only default, so
 * `rebase verify` (and the reader) can tell a decision from an omission. A
 * storefront opens tables up one at a time: `{ operation: "select", access:
 * "public" }` on products and categories for a public catalogue, and
 * `ownerField` on orders once they carry the customer's user id.
 */
export const defaultSecurityRules: SecurityRule[] = [
    { operation: "all", roles: ["admin"] }
];

export const collections = [productsCollection, categoriesCollection, ordersCollection, usersCollection];

// What `rebase dev`, `rebase db push` and the admin panel do when they read this
// directory, done here as well: a collection with no `securityRules` of its own
// gets `defaultSecurityRules`, on the collection object itself, so a relation's
// target carries them too.
for (const collection of collections) {
    if (!collection.securityRules?.length) collection.securityRules = defaultSecurityRules;
}
