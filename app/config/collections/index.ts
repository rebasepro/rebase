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
import usersCollection from "./users";

export const collections = [
    authorsCollection,
    postsCollection,
    tagsCollection,
    customersCollection,
    productsCollection,
    ordersCollection,
    orderItemsCollection,
    ticketsCollection,
    productLocalesCollection,
    exercisesCollection,
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
