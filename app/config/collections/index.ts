import type { SecurityRule } from "@rebasepro/types";
import authorsCollection from "./authors";
import postsCollection from "./posts";
import tagsCollection from "./tags";
import customersCollection from "./customers";
import productsCollection from "./products";
import ordersCollection from "./orders";
import orderItemsCollection from "./order_items";
import ticketsCollection from "./tickets";
import productLocalesCollection from "./product_locales";
import exercisesCollection from "./exercises";
import slashedSlugProbe from "./slashed_slug_probe";
import usersCollection from "./users";

/**
 * Order matters: it drives the order of the groups and of the cards inside each
 * group, both on the home page and in the drawer. Most relevant first.
 */
export const collections = [
    // E-Commerce
    productsCollection,
    ordersCollection,
    customersCollection,
    orderItemsCollection,
    productLocalesCollection,
    // Content
    postsCollection,
    authorsCollection,
    tagsCollection,
    // Support
    ticketsCollection,
    // Fitness
    exercisesCollection,
    slashedSlugProbe,
    // Settings
    usersCollection
];

/**
 * Applied to any collection here that declares no `securityRules` of its own:
 * anyone can read, only admins can write.
 *
 * Declared beside the collections because `rebase db push` generates the
 * Postgres policies from these files — that is what enforces access.
 */
export const defaultSecurityRules: SecurityRule[] = [
    { operation: "select",
access: "public" },
    { operations: ["insert", "update", "delete"],
roles: ["admin"] }
];
