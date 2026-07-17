import productsCollection from "./products.js";
import categoriesCollection from "./categories.js";
import ordersCollection from "./orders.js";
// Resolves after `rebase init` copies this file into config/collections/,
// next to the shared users.ts — not from inside presets/, which never runs.
import usersCollection from "./users.js";

export const collections = [productsCollection, categoriesCollection, ordersCollection, usersCollection];
