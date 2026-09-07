import productsCollection from "./products";
import categoriesCollection from "./categories";
import ordersCollection from "./orders";
// Resolves after `rebase init` copies this file into config/collections/,
// next to the shared users.ts — not from inside presets/, which never runs.
import usersCollection from "./users";

export const collections = [productsCollection, categoriesCollection, ordersCollection, usersCollection];
