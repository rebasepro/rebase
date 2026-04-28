import { pgTable, text, pgPolicy } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const testTable = pgTable("test", {
  id: text("id").primaryKey(),
}, (t) => [
  pgPolicy("renamed_policy", { as: "permissive", to: "public", for: "select", using: sql`true` })
]);
