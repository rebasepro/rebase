export { products } from "./products";
export { orders } from "./orders";
export { customers } from "./customers";
export { orderItems } from "./order_items";
export { productLocales } from "./product_locales";
export { posts } from "./posts";
export { authors } from "./authors";
export { tags } from "./tags";
export { tickets } from "./tickets";
export { exercises } from "./exercises";
export { users } from "./users";

export const defaultRls = [
    { operation: "select", access: "public" },
    { operations: ["insert", "update", "delete"], roles: ["admin"] }
] as const;
