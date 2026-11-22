import { productsCms } from "./products";
import { ordersCms } from "./orders";
import { customersCms } from "./customers";
import { orderItemsCms } from "./order_items";
import { productLocalesCms } from "./product_locales";
import { postsCms } from "./posts";
import { authorsCms } from "./authors";
import { tagsCms } from "./tags";
import { ticketsCms } from "./tickets";
import { exercisesCms } from "./exercises";
import { usersCms } from "./users";

/**
 * The table customizations, in the order the panel lists them: this array
 * orders the tables (a navigation group sits where its first table does), and
 * a table without a customization follows, in the order the server serves
 * them. `navigationGroupMappings` and a plugin's navigation entries override it.
 */
export const tableCustomizations = [productsCms, ordersCms, customersCms, orderItemsCms, productLocalesCms, postsCms, authorsCms, tagsCms, ticketsCms, exercisesCms, usersCms];
