export { products } from "./products.js";
export { orders } from "./orders.js";
export { customers } from "./customers.js";
export { orderItems } from "./order_items.js";
export { productLocales } from "./product_locales.js";
export { posts } from "./posts.js";
export { authors } from "./authors.js";
export { tags } from "./tags.js";
export { tickets } from "./tickets.js";
export { exercises } from "./exercises.js";
export { users } from "./users.js";
export const defaultRls = [
    { operation: "select", access: "public" },
    { operations: ["insert", "update", "delete"], roles: ["admin"] }
];
